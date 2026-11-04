// 工程 0：整形。0a 区切りと話者、0b 直す箇所の一覧、0c 意味が通らない箇所（docs/設計書.md「工程 0 の分け方と、文字起こしの直し方」）。
// 入力は、話者の無いボイスメモの文字起こし（1 本の文）。発話ごとに元の文を残し、確かでない話者には印を付ける。
// 正本は「元の文と直しの一覧」。画面に出す文はそこから当て直して作る。

import { callStructured } from "./claude.mts";
import { guardStep0c } from "./guard.mts";
import type { CallMeta } from "./types.mts";
import { STEP0A_SCHEMA, STEP0B_SCHEMA, STEP0C_SCHEMA, step0aSystem, step0aUser, step0bSystem, step0bUser, step0cSystem, step0cUser } from "./prompts.mts";
import { findLoose, normalizeLoose } from "./text.mts";
import type {
  Confidence,
  Correction,
  DiscardedCorrection,
  Guess,
  MeetingKind,
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

export type Step0Options = {
  /** 0b を回すか */
  with0b?: boolean;
  log?: (line: string) => void;
};

export type Step0Timing = { step0a: CallMeta; step0b: CallMeta | null; step0c: CallMeta | null };

/** 0a：区切りと話者。失敗したら投げる（発話の並びが無いと先へ進めない）。 */
export async function step0a(raw: string, kind: MeetingKind): Promise<{ parsed: Step0aRaw; meta: CallMeta }> {
  const r = await callStructured<{ utterances: Step0aRaw["utterances"]; multiple_others: boolean; multiple_others_reason: string }>({
    system: step0aSystem(kind),
    user: step0aUser(raw),
    schema: STEP0A_SCHEMA,
    effort: "medium",
    label: "工程 0a",
  });
  const parsed: Step0aRaw = {
    utterances: r.data.utterances,
    multipleOthers: r.data.multiple_others,
    multipleOthersReason: r.data.multiple_others_reason || undefined,
  };
  return { parsed, meta: r.meta };
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
  const a = await step0a(raw, kind);
  log(`0a ${a.meta.ms} ms、発話 ${a.parsed.utterances.length}`);
  const anchored = anchorUtterances(raw, a.parsed, kind);
  const utterances = anchored.utterances;
  log(`当て直し：${utterances.length} 発話、当て直せなかった ${anchored.unanchored}`);
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
      multipleOthers: a.parsed.multipleOthers,
      step0b: step0bResult,
      step0c: null,
    },
    timing: { step0a: a.meta, step0b: bMeta, step0c: null },
    unanchored: anchored.unanchored,
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
