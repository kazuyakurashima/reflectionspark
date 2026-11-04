// 工程 0：整形。0a 区切りと話者、0b 直す箇所の一覧、0c 意味が通らない箇所（docs/設計書.md「工程 0 の分け方と、文字起こしの直し方」）。
// 入力は、話者の無いボイスメモの文字起こし（1 本の文）。発話ごとに元の文を残し、確かでない話者には印を付ける。
// 正本は「元の文と直しの一覧」。画面に出す文はそこから当て直して作る。

import { callStructured, STEP0_EFFORT, STEP0_MODEL } from "./claude.mts";
import type { Effort } from "./claude.mts";
import { guardStep0c } from "./guard.mts";
import type { CallMeta } from "./types.mts";
import {
  STEP0A_LABEL_SCHEMA,
  STEP0A_SCHEMA,
  STEP0B_SCHEMA,
  STEP0C_SCHEMA,
  step0aLabelSystem,
  step0aLabelUser,
  step0aSystem,
  step0aUser,
  step0bSystem,
  step0bUser,
  step0cSystem,
  step0cUser,
} from "./prompts.mts";
import { findLoose, normalizeLoose } from "./text.mts";
import type {
  Confidence,
  Correction,
  DiscardedCorrection,
  Guess,
  MeetingKind,
  Step0aLabelRaw,
  Step0aMode,
  Step0aRaw,
  Step0bResult,
  Step0cResult,
  Transcript,
  Utterance,
} from "./types.mts";
import { SPEAKER_LABELS } from "./types.mts";

export const CHECK_LOW_CONFIDENCE = "話者の確からしさが低い";
export const CHECK_MID_CONFIDENCE = "話者の確からしさが中";
export const CHECK_CORRECTED = "聞き違いを直した所がある";
export const CHECK_MULTIPLE_OTHERS = "相手が 2 人以上と推定した";
export const CHECK_UNANCHORED = "区切りが分からない所（モデルの区切りを元の文に当て直せなかった。本人が分けてください）";
export const CHECK_SPEAKER_LABEL = "話者ラベルが読めなかった";

/** これより短い残り（正規化後の文字数）は、区切りのずれとみなして前の発話に含める */
const GAP_MIN_CHARS = 6;

export const STEP0A_MODES: Step0aMode[] = ["copy", "label"];

/** 0a の作り方の文字列を読む。空なら null、読めなければ投げる。 */
export function parseStep0aMode(value: string | undefined, name = "0a の作り方"): Step0aMode | null {
  const v = (value ?? "").trim();
  if (v === "") return null;
  if ((STEP0A_MODES as string[]).includes(v)) return v as Step0aMode;
  throw new Error(`${name}の値が読めません：${v}（copy か label）`);
}

/** 0a の作り方の既定。環境変数 REFLECTIONSPARK_STEP0_MODE で変えられる。既定は copy（今の作り方）。 */
export const STEP0A_MODE: Step0aMode = parseStep0aMode(process.env.REFLECTIONSPARK_STEP0_MODE, "REFLECTIONSPARK_STEP0_MODE") ?? "copy";

/**
 * 0a の出力（モデルが写した本文）を、元の文字起こしに当て直す。
 * モデルが一字でも変えていても、画面と照合に使う本文は元の文字起こしの切り出しにする（言葉を変えない）。
 * 当て直せた発話は、その範囲（始まりから終わり）で元の文を切る。当て直せなかった発話や、どの発話にも当たらなかった元の文は、
 * 前の発話にくっつけず（相手の言葉が本人の発話に入り、引用に使われるのを防ぐ）、「区切りが分からない所」として別の発話に残し、
 * 画面 1 で本人が分けられるようにする。数文字の残りだけは区切りのずれとみなして前の発話に含める。
 */
export function anchorUtterances(raw: string, parsed: Step0aRaw, kind: MeetingKind): { utterances: Utterance[]; unanchored: number } {
  const { self, other } = SPEAKER_LABELS[kind];
  const rawCp = [...raw];
  const norm = normalizeLoose(raw);
  type Found = { start: number; end: number; speaker: string; confidence: Confidence; reason?: string; check: string[]; pending: { text: string; speaker: string }[] };
  const found: Found[] = [];
  let cursor = 0;
  let unanchored = 0;
  let pending: { text: string; speaker: string }[] = [];
  const labelOf = (raw: string, check: string[]) => {
    const sp = raw.trim();
    if (sp === self || sp === other) return sp;
    check.push(CHECK_SPEAKER_LABEL);
    return sp.includes(self) ? self : other;
  };
  for (const u of parsed.utterances) {
    const text = u.text.trim();
    if (text === "") continue;
    const check: string[] = [];
    const speaker = labelOf(u.speaker, check);
    const hit = findLoose(norm, text, cursor, 0.7);
    if (!hit) {
      unanchored++;
      pending.push({ text, speaker });
      continue;
    }
    if (u.confidence === "低") check.push(CHECK_LOW_CONFIDENCE);
    else if (u.confidence === "中") check.push(CHECK_MID_CONFIDENCE);
    if (parsed.multipleOthers) check.push(CHECK_MULTIPLE_OTHERS);
    found.push({ start: hit.start, end: hit.end, speaker, confidence: u.confidence, reason: u.reason || undefined, check, pending });
    pending = [];
    cursor = hit.end;
  }
  if (found.length === 0) throw new Error("0a：発話を元の文字起こしに当て直せませんでした（発話の並びが無いと先へ進めません）");

  // 区切りの並び：当て直せた発話と、その間の残り（区切りが分からない所）
  type Piece = { start: number; end: number; speaker: string; confidence: Confidence; reason?: string; check: string[] };
  const pieces: Piece[] = [];
  const trimSpan = (s: number, e: number): [number, number] => {
    while (s < e && /\s/.test(rawCp[s])) s++;
    while (e > s && /\s/.test(rawCp[e - 1])) e--;
    return [s, e];
  };
  const normLen = (s: number, e: number) => normalizeLoose(rawCp.slice(s, e).join("")).chars.length;
  const pushGap = (s0: number, e: number, pend: { text: string; speaker: string }[], prev: Piece | null) => {
    // 残りの先頭の句読点（正規化で消える文字）は、前の発話の終わりに含める（当て直しは句読点を数えないため）
    let s = s0;
    while (s < e && !/\s/.test(rawCp[s]) && normalizeLoose(rawCp[s]).chars.length === 0) s++;
    if (prev && s > s0) prev.end = s;
    const [ts, te] = trimSpan(s, e);
    if (ts >= te) return;
    const len = normLen(ts, te);
    if (pend.length === 0 && len < GAP_MIN_CHARS) {
      // 数文字の残りは区切りのずれ：前の発話に含める（前が無ければ次の発話の始まりに含める）
      if (prev) prev.end = te;
      else pieces.push({ start: ts, end: te, speaker: found[0].speaker, confidence: "低", reason: undefined, check: [CHECK_UNANCHORED] });
      return;
    }
    const note = pend.length ? `（モデルの区切り：${pend.map((p) => `${p.speaker}「${p.text}」`).join("／")}）` : "（モデルの出力に無かった所）";
    pieces.push({
      start: ts,
      end: te,
      speaker: pend[0]?.speaker ?? prev?.speaker ?? other,
      confidence: "低",
      reason: `区切りを当て直せなかった${note}`,
      check: [CHECK_UNANCHORED + note],
    });
  };
  // 先頭の残り
  pushGap(0, found[0].start, found[0].pending, null);
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    const [s, e] = trimSpan(f.start, f.end);
    const piece: Piece = { start: s, end: e, speaker: f.speaker, confidence: f.confidence, reason: f.reason, check: f.check };
    pieces.push(piece);
    const nextStart = i + 1 < found.length ? found[i + 1].start : rawCp.length;
    const nextPending = i + 1 < found.length ? found[i + 1].pending : pending;
    pushGap(f.end, nextStart, nextPending, piece);
  }
  // 当て直せなかった発話が末尾にあり、残りの文も無いとき（モデルが足した文など）は、最後の発話に印だけ付ける
  if (pending.length && pieces.length && !pieces[pieces.length - 1].check.some((c) => c.startsWith(CHECK_UNANCHORED))) {
    const lastGap = trimSpan(found[found.length - 1].end, rawCp.length);
    if (lastGap[0] >= lastGap[1]) pieces[pieces.length - 1].check.push(`${CHECK_UNANCHORED}（モデルの区切り：${pending.map((p) => p.text).join("／")}。元の文には残りが無い）`);
  }
  const utterances: Utterance[] = pieces
    .map((p) => {
      const [s, e] = trimSpan(p.start, p.end);
      return { ...p, start: s, end: e };
    })
    .filter((p) => p.end > p.start)
    .map((p, i) => {
      const original = rawCp.slice(p.start, p.end).join("");
      return { index: i, speaker: p.speaker, text: original, original, confidence: p.confidence, confidenceReason: p.reason, check: p.check, memoSpan: [p.start, p.end] as [number, number] };
    });
  return { utterances, unanchored };
}

// ---------- 0a の速い作り方（label）：アプリが文に切り、モデルは番号ごとの話者だけを返す ----------

/** アプリが切った文。[start, end) は元の文字起こしのコードポイント位置、text はその切り出し（言葉を変えない） */
export type Sentence = { n: number; start: number; end: number; text: string };

const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "\n", "\r"]);
const SENTENCE_CLOSERS = new Set(["」", "』", "）", ")", "］", "]", "〕", "｝", "}", "〉", "》", "”", "’", '"', "'"]);
const SOFT_BREAK = new Set(["、", "，", ",", " ", "　", "\t"]);
/** これより長い文は、読点や空白でさらに切る（句読点の無い文字起こしでも文が長くなりすぎないように） */
const LONG_SENTENCE = 80;

/**
 * 元の文字起こしを文に切る。文の終わり（。？！と改行）で切り、終わりに続く「」」などの閉じ括弧は前の文に含める。
 * 長い文は読点や空白でさらに切る。空白だけの所は文にしない。すべての空白でない文字がどれかの文に入る。
 */
export function splitSentences(raw: string): Sentence[] {
  const cps = [...raw];
  const spans: [number, number][] = [];
  let start = 0;
  let i = 0;
  while (i < cps.length) {
    if (SENTENCE_END.has(cps[i])) {
      let e = i + 1;
      while (e < cps.length && (SENTENCE_END.has(cps[e]) || SENTENCE_CLOSERS.has(cps[e]))) e++;
      spans.push([start, e]);
      start = e;
      i = e;
    } else i++;
  }
  if (start < cps.length) spans.push([start, cps.length]);
  const trim = (s: number, e: number): [number, number] => {
    while (s < e && /\s/.test(cps[s])) s++;
    while (e > s && /\s/.test(cps[e - 1])) e--;
    return [s, e];
  };
  const out: Sentence[] = [];
  const push = (s0: number, e0: number) => {
    const [s, e] = trim(s0, e0);
    if (s >= e) return;
    out.push({ n: out.length, start: s, end: e, text: cps.slice(s, e).join("") });
  };
  for (const [s0, e0] of spans) {
    const [s, e] = trim(s0, e0);
    if (e - s <= LONG_SENTENCE) {
      push(s, e);
      continue;
    }
    // 長い文：読点や空白の後で切る（切った後の文が LONG_SENTENCE の半分以上になる所だけ）
    let from = s;
    for (let k = s; k < e; k++) {
      if (SOFT_BREAK.has(cps[k]) && k + 1 - from >= LONG_SENTENCE / 2 && e - (k + 1) >= 4) {
        push(from, k + 1);
        from = k + 1;
      }
    }
    push(from, e);
  }
  return out;
}

/** 文の中で、モデルが返した「後の話者の言葉の始まり」の位置（文の先頭からのコードポイント数）を探す。無ければ null。 */
export function findSplitAt(sentenceText: string, at: string): number | null {
  const needle = at.trim();
  if (needle === "") return null;
  const exact = sentenceText.indexOf(needle);
  if (exact >= 0) return [...sentenceText.slice(0, exact)].length;
  // 句読点や空白の違いだけなら、ゆるい照合で探す（短い文字列は誤って当たりやすいので 3 字以上に限る）
  if (normalizeLoose(needle).chars.length < 3) return null;
  const hit = findLoose(normalizeLoose(sentenceText), needle, 0, 0.75);
  return hit ? hit.start : null;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { 高: 2, 中: 1, 低: 0 };
const isConfidence = (c: unknown): c is Confidence => c === "高" || c === "中" || c === "低";

/**
 * 0a（label）の返事を、アプリが切った文に当てて発話の並びにする。
 * 本文はいつも元の文字起こしの切り出しで、言葉を変えない。同じ話者が続く文は 1 つの発話にまとめる。
 * 確からしさが「低」の文、話者ラベルが読めなかった文、モデルの返事に無かった文、モデルの区切り（at）が文に無かった文は、
 * まとめずに 1 つの発話にし、本人が画面 1 で確かめて分けられるようにする（無かった文と当たらなかった区切りは「区切りが分からない所」の印）。
 */
export function labelUtterances(raw: string, sentences: Sentence[], parsed: Step0aLabelRaw, kind: MeetingKind): { utterances: Utterance[]; unanchored: number } {
  const { self, other } = SPEAKER_LABELS[kind];
  const rawCp = [...raw];
  if (sentences.length === 0) throw new Error("0a：文字起こしに文がありません");
  const labelOf = (sp: string, check: string[]) => {
    const t = (sp ?? "").trim();
    if (t === self || t === other) return t;
    check.push(CHECK_SPEAKER_LABEL);
    return t.includes(self) ? self : other;
  };
  const labels = new Map<number, Step0aLabelRaw["sentences"][number]>();
  for (const l of parsed.sentences ?? []) if (Number.isInteger(l.n) && !labels.has(l.n)) labels.set(l.n, l);
  const reasons = new Map<number, string>();
  for (const r of parsed.reasons ?? []) if (Number.isInteger(r.n) && r.reason && !reasons.has(r.n)) reasons.set(r.n, r.reason);
  const splitsOf = new Map<number, Step0aLabelRaw["splits"]>();
  for (const sp of parsed.splits ?? []) {
    if (!Number.isInteger(sp.n)) continue;
    const arr = splitsOf.get(sp.n) ?? [];
    arr.push(sp);
    splitsOf.set(sp.n, arr);
  }

  type Piece = { start: number; end: number; speaker: string; confidence: Confidence; reason?: string; check: string[]; solo: boolean };
  /** まとめない文：確からしさが低い、印が付いている（話者ラベルが読めない、など） */
  const isSolo = (p: { confidence: Confidence; check: string[] }) => p.confidence === "低" || p.check.length > 0;
  const pieces: Piece[] = [];
  let unanchored = 0;
  let prevSpeaker: string | null = null;
  for (const sen of sentences) {
    const label = labels.get(sen.n);
    if (!label) {
      unanchored++;
      const note = `（モデルの返事に文 ${sen.n} が無かった）`;
      pieces.push({ start: sen.start, end: sen.end, speaker: prevSpeaker ?? other, confidence: "低", reason: `区切りを当て直せなかった${note}`, check: [CHECK_UNANCHORED + note], solo: true });
      continue;
    }
    const check: string[] = [];
    const speaker = labelOf(label.speaker, check);
    const confidence: Confidence = isConfidence(label.confidence) ? label.confidence : "低";
    const reason = reasons.get(sen.n);
    // 一文の中で話者が替わる所：位置を探し、文の先頭からの順に並べる。見つからないものがあれば、その文は「区切りが分からない所」にする
    const found: { pos: number; sp: Step0aLabelRaw["splits"][number] }[] = [];
    let lost: string | null = null;
    for (const sp of splitsOf.get(sen.n) ?? []) {
      const pos = findSplitAt(sen.text, sp.at ?? "");
      if (pos === null) {
        lost = sp.at ?? "";
        break;
      }
      found.push({ pos, sp });
    }
    if (lost !== null) {
      unanchored++;
      const note = `（モデルの区切り「${lost}」がこの文に無い）`;
      pieces.push({ start: sen.start, end: sen.end, speaker, confidence: "低", reason: `区切りを当て直せなかった${note}`, check: [...check, CHECK_UNANCHORED + note], solo: true });
      prevSpeaker = speaker;
      continue;
    }
    found.sort((a, b) => a.pos - b.pos);
    let cur = { speaker, confidence, reason, check };
    let cursor = sen.start;
    for (const { pos, sp } of found) {
      const at = sen.start + pos;
      if (at > cursor) pieces.push({ start: cursor, end: at, ...cur, solo: isSolo(cur) });
      const c2: string[] = [];
      const s2 = labelOf(sp.speaker, c2);
      cur = { speaker: s2, confidence: isConfidence(sp.confidence) ? sp.confidence : "低", reason: sp.reason || undefined, check: c2 };
      cursor = Math.max(cursor, at);
    }
    pieces.push({ start: cursor, end: sen.end, ...cur, solo: isSolo(cur) });
    prevSpeaker = cur.speaker;
  }

  // 同じ話者が続く所は 1 つの発話にまとめる（低・区切りが分からない所はまとめない）。確からしさは低い方を取る
  const trimSpan = (s: number, e: number): [number, number] => {
    while (s < e && /\s/.test(rawCp[s])) s++;
    while (e > s && /\s/.test(rawCp[e - 1])) e--;
    return [s, e];
  };
  const merged: Piece[] = [];
  for (const p of pieces) {
    const [s, e] = trimSpan(p.start, p.end);
    if (s >= e) continue;
    const prev = merged[merged.length - 1];
    if (prev && !prev.solo && !p.solo && prev.speaker === p.speaker) {
      prev.end = e;
      if (CONFIDENCE_RANK[p.confidence] < CONFIDENCE_RANK[prev.confidence]) prev.confidence = p.confidence;
      prev.reason = prev.reason ?? p.reason;
      for (const c of p.check) if (!prev.check.includes(c)) prev.check.push(c);
      continue;
    }
    merged.push({ ...p, start: s, end: e, check: [...p.check] });
  }
  if (merged.length === 0) throw new Error("0a：発話の並びを作れませんでした（文が空です）");
  const utterances: Utterance[] = merged.map((p, i) => {
    const original = rawCp.slice(p.start, p.end).join("");
    const check = p.check.filter((c) => c !== CHECK_LOW_CONFIDENCE && c !== CHECK_MID_CONFIDENCE);
    if (p.confidence === "低" && !check.includes(CHECK_LOW_CONFIDENCE)) check.push(CHECK_LOW_CONFIDENCE);
    else if (p.confidence === "中") check.push(CHECK_MID_CONFIDENCE);
    if (parsed.multipleOthers) check.push(CHECK_MULTIPLE_OTHERS);
    return { index: i, speaker: p.speaker, text: original, original, confidence: p.confidence, confidenceReason: p.reason, check, memoSpan: [p.start, p.end] as [number, number] };
  });
  return { utterances, unanchored };
}

/**
 * 0b の直しを当てる（設計書の当て方の決まり）。
 * 当てるのは、直す前の文字列がその発話にちょうど 1 か所あるものだけ。空のもの、何も変わらないもの、改行が入るもの、
 * 発話番号が範囲の外のものは捨て、理由を残す。同じ発話の 2 件目は、1 件目を当てた後の文で確かめる。
 */
export function applyCorrections(utterances: Utterance[], proposed: Correction[]): Step0bResult {
  const applied: Correction[] = [];
  const discarded: DiscardedCorrection[] = [];
  const texts = new Map<number, string>();
  for (const c of proposed) {
    const reason = (r: string) => discarded.push({ ...c, reason: r });
    if (!Number.isInteger(c.index) || c.index < 0 || c.index >= utterances.length) {
      reason("発話番号が範囲の外");
      continue;
    }
    if (!c.before || c.before.trim() === "") {
      reason("直す前が空");
      continue;
    }
    if (c.after === undefined || c.after === null) {
      reason("直した後が無い");
      continue;
    }
    if (c.before === c.after) {
      reason("何も変わらない");
      continue;
    }
    if (/\r|\n/.test(c.before) || /\r|\n/.test(c.after)) {
      reason("改行が入っている");
      continue;
    }
    const u = utterances[c.index];
    const current = texts.get(c.index) ?? u.text ?? u.original;
    const first = current.indexOf(c.before);
    if (first === -1) {
      reason("直す前の文字列がその発話に無い");
      continue;
    }
    if (current.indexOf(c.before, first + 1) !== -1) {
      reason("直す前の文字列がその発話に 2 か所以上ある");
      continue;
    }
    const next = current.slice(0, first) + c.after + current.slice(first + c.before.length);
    texts.set(c.index, next);
    applied.push({ index: c.index, kind: c.kind, before: c.before, after: c.after });
  }
  for (const [i, t] of texts) {
    utterances[i].text = t;
    if (!utterances[i].check.includes(CHECK_CORRECTED)) utterances[i].check.push(CHECK_CORRECTED);
  }
  return { proposed, applied, discarded };
}

/** 0a の呼び方。省略すると環境変数の既定（REFLECTIONSPARK_STEP0_MODE・_MODEL・_EFFORT） */
export type Step0aOptions = {
  mode?: Step0aMode;
  model?: string;
  effort?: Effort;
};

export type Step0Options = Step0aOptions & {
  /** 0b を回すか */
  with0b?: boolean;
  log?: (line: string) => void;
};

export type Step0Timing = { step0a: CallMeta; step0b: CallMeta | null; step0c: CallMeta | null };

/** 0a（copy。今の作り方）：モデルに本文を写させる。失敗したら投げる（発話の並びが無いと先へ進めない）。 */
export async function step0a(raw: string, kind: MeetingKind, opts: Step0aOptions = {}): Promise<{ parsed: Step0aRaw; meta: CallMeta }> {
  const r = await callStructured<{ utterances: Step0aRaw["utterances"]; multiple_others: boolean; multiple_others_reason: string }>({
    system: step0aSystem(kind),
    user: step0aUser(raw),
    schema: STEP0A_SCHEMA,
    model: opts.model ?? STEP0_MODEL,
    effort: opts.effort ?? STEP0_EFFORT,
    label: "工程 0a",
  });
  const parsed: Step0aRaw = {
    utterances: r.data.utterances,
    multipleOthers: r.data.multiple_others,
    multipleOthersReason: r.data.multiple_others_reason || undefined,
  };
  return { parsed, meta: r.meta };
}

/** 0a（label。速い作り方）：アプリが切った文に、番号ごとの話者だけを返させる。失敗したら投げる。 */
export async function step0aLabel(sentences: Sentence[], kind: MeetingKind, opts: Step0aOptions = {}): Promise<{ parsed: Step0aLabelRaw; meta: CallMeta }> {
  const r = await callStructured<{
    sentences: Step0aLabelRaw["sentences"];
    reasons: Step0aLabelRaw["reasons"];
    splits: Step0aLabelRaw["splits"];
    multiple_others: boolean;
    multiple_others_reason: string;
  }>({
    system: step0aLabelSystem(kind),
    user: step0aLabelUser(sentences),
    schema: STEP0A_LABEL_SCHEMA,
    model: opts.model ?? STEP0_MODEL,
    effort: opts.effort ?? STEP0_EFFORT,
    label: "工程 0a（label）",
  });
  const parsed: Step0aLabelRaw = {
    sentences: r.data.sentences ?? [],
    reasons: r.data.reasons ?? [],
    splits: r.data.splits ?? [],
    multipleOthers: Boolean(r.data.multiple_others),
    multipleOthersReason: r.data.multiple_others_reason || undefined,
  };
  return { parsed, meta: r.meta };
}

export type Step0aOutcome = {
  mode: Step0aMode;
  utterances: Utterance[];
  /** 当て直せなかった発話・文の数（「区切りが分からない所」） */
  unanchored: number;
  multipleOthers: boolean;
  multipleOthersReason?: string;
  meta: CallMeta;
  /** label のとき、アプリが切った文の数。copy では null */
  sentences: number | null;
  /** モデルの返事（記録用） */
  modelOutput: Step0aRaw | Step0aLabelRaw;
};

/** 0a を作り方（copy／label）で回し、元の文字起こしに当てた発話の並びを返す。 */
export async function runStep0a(raw: string, kind: MeetingKind, opts: Step0aOptions = {}): Promise<Step0aOutcome> {
  const mode = opts.mode ?? STEP0A_MODE;
  if (mode === "label") {
    const sentences = splitSentences(raw);
    if (sentences.length === 0) throw new Error("0a：文字起こしが空です");
    const r = await step0aLabel(sentences, kind, opts);
    const a = labelUtterances(raw, sentences, r.parsed, kind);
    return { mode, utterances: a.utterances, unanchored: a.unanchored, multipleOthers: r.parsed.multipleOthers, multipleOthersReason: r.parsed.multipleOthersReason, meta: r.meta, sentences: sentences.length, modelOutput: r.parsed };
  }
  const r = await step0a(raw, kind, opts);
  const a = anchorUtterances(raw, r.parsed, kind);
  return { mode, utterances: a.utterances, unanchored: a.unanchored, multipleOthers: r.parsed.multipleOthers, multipleOthersReason: r.parsed.multipleOthersReason, meta: r.meta, sentences: null, modelOutput: r.parsed };
}

/** 0b：直す箇所の一覧。返事が読めないときは直さずに先へ進む。 */
export async function step0b(utterances: Utterance[], kind: MeetingKind): Promise<{ result: Step0bResult; meta: CallMeta | null }> {
  try {
    const r = await callStructured<{ corrections: Correction[] }>({
      system: step0bSystem(kind),
      user: step0bUser(utterances),
      schema: STEP0B_SCHEMA,
      effort: "medium",
      label: "工程 0b",
    });
    return { result: applyCorrections(utterances, r.data.corrections ?? []), meta: r.meta };
  } catch (e) {
    return { result: { proposed: [], applied: [], discarded: [], failed: (e as Error).message }, meta: null };
  }
}

/** 0c：意味が通らない箇所。失敗しても分析は止めない。 */
export async function step0c(utterances: Utterance[], kind: MeetingKind): Promise<{ result: Step0cResult; meta: CallMeta | null }> {
  try {
    const r = await callStructured<{ summary: string; places: Guess[] }>({
      system: step0cSystem(kind),
      user: step0cUser(utterances),
      schema: STEP0C_SCHEMA,
      effort: "medium",
      label: "工程 0c",
    });
    const guesses = (r.data.places ?? []).filter((g) => Number.isInteger(g.index) && g.index >= 0 && g.index < utterances.length && g.fragment);
    return { result: guardStep0c({ summary: r.data.summary, guesses }, utterances), meta: r.meta };
  } catch (e) {
    return { result: { summary: "", guesses: [], failed: (e as Error).message }, meta: null };
  }
}

/** 工程 0 を通しで回す。 */
export async function runStep0(raw: string, kind: MeetingKind, opts: Step0Options = {}): Promise<{ transcript: Transcript; timing: Step0Timing; unanchored: number }> {
  const log = opts.log ?? (() => {});
  const a = await runStep0a(raw, kind, opts);
  log(`0a（${a.mode}、${a.meta.model}、${opts.effort ?? STEP0_EFFORT}）${a.meta.ms} ms、出力 ${a.meta.outputTokens} トークン${a.sentences !== null ? `、文 ${a.sentences}` : ""}`);
  const utterances = a.utterances;
  log(`当て直し：${utterances.length} 発話、当て直せなかった ${a.unanchored}`);
  let step0bResult: Step0bResult = { proposed: [], applied: [], discarded: [] };
  let bMeta: CallMeta | null = null;
  if (opts.with0b !== false) {
    const b = await step0b(utterances, kind);
    step0bResult = b.result;
    bMeta = b.meta;
    log(`0b ${bMeta?.ms ?? "-"} ms、提案 ${b.result.proposed.length}、当てた ${b.result.applied.length}、捨てた ${b.result.discarded.length}${b.result.failed ? `、失敗：${b.result.failed}` : ""}`);
  }
  // 0c（意味が通らない箇所）はここでは回さない。runStep0c で別に回し、分析と同時に送る（設計書「失敗の扱い」）
  return {
    transcript: {
      kind,
      raw,
      utterances,
      multipleOthers: a.multipleOthers,
      step0b: step0bResult,
      step0c: null,
      step0aMode: a.mode,
    },
    timing: { step0a: a.meta, step0b: bMeta, step0c: null },
    unanchored: a.unanchored,
  };
}

/**
 * 0c：意味が通らない箇所。工程 0 とは別に回し、分析と同時に送る。元の文（0b を当てる前）で回す。
 * 失敗したり遅れたりしても分析は止めない（結果は推測なしで出す）。
 */
export async function runStep0c(t: Transcript): Promise<{ result: Step0cResult; meta: CallMeta | null }> {
  return step0c(
    t.utterances.map((u) => ({ ...u, text: u.original })),
    t.kind,
  );
}

/**
 * 0c の結果を文字起こしに付ける。発話の並びが変わっていたら（本人が分けた、など）番号がずれるので付けず、理由を残す。
 */
export function attachStep0c(t: Transcript, result: Step0cResult, utteranceCountAtRequest: number): Transcript {
  if (t.utterances.length !== utteranceCountAtRequest) {
    return { ...t, step0c: { summary: result.summary, guesses: [], failed: `発話の並びが変わった（${utteranceCountAtRequest} → ${t.utterances.length}）ので推測を当てなかった` } };
  }
  return { ...t, step0c: result };
}

/** 短く待つ。間に合えば結果、間に合わなければ null（待ち続けない） */
export function waitShort<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** 画面 1 の「確かめる所」：印の付いた発話を先に出す。 */
export function utterancesToCheck(t: Transcript): Utterance[] {
  return t.utterances.filter((u) => u.check.length > 0);
}
