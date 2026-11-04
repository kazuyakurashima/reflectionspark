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
export const CHECK_UNANCHORED = "区切りを元の文に当て直せなかった発話を含む";
export const CHECK_SPEAKER_LABEL = "話者ラベルが読めなかった";

/**
 * 0a の出力（モデルが写した本文）を、元の文字起こしに当て直す。
 * モデルが一字でも変えていても、画面と照合に使う本文は元の文字起こしの切り出しにする（言葉を変えない）。
 * 当て直せた発話の始まりで元の文を切り、全文を発話で覆う。当て直せなかった発話は前の発話に含め、印を付ける。
 */
export function anchorUtterances(raw: string, parsed: Step0aRaw, kind: MeetingKind): { utterances: Utterance[]; unanchored: number } {
  const { self, other } = SPEAKER_LABELS[kind];
  const rawCp = [...raw];
  const norm = normalizeLoose(raw);
  type Found = { start: number; speaker: string; confidence: Confidence; reason?: string; check: string[]; modelText: string };
  const found: Found[] = [];
  let cursor = 0;
  let unanchored = 0;
  const pendingNotes: string[] = [];
  for (const u of parsed.utterances) {
    const text = u.text.trim();
    if (text === "") continue;
    const hit = findLoose(norm, text, cursor, 0.7);
    const check: string[] = [];
    let speaker = u.speaker.trim();
    if (speaker !== self && speaker !== other) {
      speaker = speaker.includes(self) ? self : speaker.includes(other) ? other : other;
      check.push(CHECK_SPEAKER_LABEL);
    }
    if (!hit) {
      unanchored++;
      pendingNotes.push(text);
      continue;
    }
    if (pendingNotes.length) {
      // 当て直せなかった発話は前の発話に含め、無ければこの発話に印を付ける
      const target = found.length ? found[found.length - 1] : null;
      if (target) target.check.push(`${CHECK_UNANCHORED}（${pendingNotes.join("／")}）`);
      else check.push(`${CHECK_UNANCHORED}（${pendingNotes.join("／")}）`);
      pendingNotes.length = 0;
    }
    if (u.confidence === "低") check.push(CHECK_LOW_CONFIDENCE);
    else if (u.confidence === "中") check.push(CHECK_MID_CONFIDENCE);
    if (parsed.multipleOthers) check.push(CHECK_MULTIPLE_OTHERS);
    found.push({ start: hit.start, speaker, confidence: u.confidence, reason: u.reason || undefined, check, modelText: text });
    cursor = hit.end;
  }
  if (pendingNotes.length && found.length) found[found.length - 1].check.push(`${CHECK_UNANCHORED}（${pendingNotes.join("／")}）`);
  if (found.length === 0) throw new Error("0a：発話を元の文字起こしに当て直せませんでした（発話の並びが無いと先へ進めません）");
  found[0].start = 0;
  const utterances: Utterance[] = found.map((f, i) => {
    const end = i + 1 < found.length ? found[i + 1].start : rawCp.length;
    // 前後の空白を除いた範囲にする
    let s = f.start;
    let e = end;
    while (s < e && /\s/.test(rawCp[s])) s++;
    while (e > s && /\s/.test(rawCp[e - 1])) e--;
    const original = rawCp.slice(s, e).join("");
    return {
      index: i,
      speaker: f.speaker,
      text: original,
      original,
      confidence: f.confidence,
      confidenceReason: f.reason,
      check: f.check,
      memoSpan: [s, e],
    };
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
  /** 0c を回すか（分析と同時に別に送るので、評価では回し、画面では非同期に回す） */
  with0c?: boolean;
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
  let cMeta: CallMeta | null = null;
  let step0cResult: Step0cResult | null = null;
  const bPromise = opts.with0b === false ? null : step0b(utterances, kind);
  // 0c は元の文（0b を当てる前）で回し、分析と同時に別に送る
  const cPromise = opts.with0c ? step0c(utterances.map((u) => ({ ...u, text: u.original })), kind) : null;
  if (bPromise) {
    const b = await bPromise;
    step0bResult = b.result;
    bMeta = b.meta;
    log(`0b ${bMeta?.ms ?? "-"} ms、提案 ${b.result.proposed.length}、当てた ${b.result.applied.length}、捨てた ${b.result.discarded.length}${b.result.failed ? `、失敗：${b.result.failed}` : ""}`);
  }
  if (cPromise) {
    const c = await cPromise;
    step0cResult = c.result;
    cMeta = c.meta;
    log(`0c ${cMeta?.ms ?? "-"} ms、推測 ${c.result.guesses.length}${c.result.failed ? `、失敗：${c.result.failed}` : ""}`);
  }
  return {
    transcript: {
      kind,
      raw,
      utterances,
      multipleOthers: a.parsed.multipleOthers,
      step0b: step0bResult,
      step0c: step0cResult,
    },
    timing: { step0a: a.meta, step0b: bMeta, step0c: cMeta },
    unanchored: anchored.unanchored,
  };
}

/** 画面 1 の「確かめる所」：印の付いた発話を先に出す。 */
export function utterancesToCheck(t: Transcript): Utterance[] {
  return t.utterances.filter((u) => u.check.length > 0);
}
