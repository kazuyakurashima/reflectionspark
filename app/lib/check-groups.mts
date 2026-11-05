// 画面 1 の「確かめる所」を種類ごとに分ける。AI を呼ばない。
// 見る必要が高い所（話者・区切り・相手の数）を先に一つずつ出し、聞き違いの直しは同じ直しを 1 行にまとめる。
// 印の文字列は engine/step0.mts の CHECK_* と同じ（画面からサーバーの部品を読み込まないため、ここに写し、テストで一致を守る）。

import type { Correction, Transcript, Utterance } from "../../engine/types.mts";

export const MARK_SPEAKER_LOW = "話者の確からしさが低い";
export const MARK_SPEAKER_MID = "話者の確からしさが中";
export const MARK_SPEAKER_LABEL = "話者ラベルが読めなかった";
export const MARK_UNANCHORED = "区切りが分からない所";
export const MARK_MULTIPLE = "相手が 2 人以上と推定した";
export const MARK_CORRECTED = "聞き違いを直した所がある";
export const MARK_EDITED = "本人が直した";

/** 確かめる所に出すか：話者の確からしさが「中」だけの発話は出さない */
export function needsCheck(u: Utterance): boolean {
  return u.check.some((c) => !c.startsWith(MARK_SPEAKER_MID));
}

export type CorrectionGroup = { before: string; after: string; kind: string; indices: number[] };

export type CheckGroups = {
  /** 区切りが分からない所（本人が分ける） */
  unanchored: Utterance[];
  /** 話者を確かめる所（確からしさが低い、ラベルが読めない） */
  speaker: Utterance[];
  /** 相手が 2 人以上と推定した所 */
  multiple: Utterance[];
  /** 聞き違いを直しただけの所 */
  corrected: Utterance[];
  /** 聞き違いの直しを「前 → 後」ごとにまとめたもの（多い順） */
  correctionGroups: CorrectionGroup[];
  /** 本人が直しただけの所 */
  edited: Utterance[];
  /** どれにも当たらない所 */
  other: Utterance[];
};

const has = (u: Utterance, mark: string) => u.check.some((c) => c.startsWith(mark));

/** 一つの発話は、上の順で最初に当たった種類にだけ入れる（同じ発話を二度出さない） */
export function groupChecks(t: Transcript): CheckGroups {
  const g: CheckGroups = { unanchored: [], speaker: [], multiple: [], corrected: [], correctionGroups: [], edited: [], other: [] };
  for (const u of t.utterances.filter(needsCheck)) {
    if (has(u, MARK_UNANCHORED)) g.unanchored.push(u);
    else if (has(u, MARK_SPEAKER_LOW) || has(u, MARK_SPEAKER_LABEL)) g.speaker.push(u);
    else if (has(u, MARK_MULTIPLE)) g.multiple.push(u);
    else if (has(u, MARK_CORRECTED)) g.corrected.push(u);
    else if (has(u, MARK_EDITED)) g.edited.push(u);
    else g.other.push(u);
  }
  const inCorrected = new Set(g.corrected.map((u) => u.index));
  const byPair = new Map<string, CorrectionGroup>();
  for (const c of t.step0b.applied as Correction[]) {
    if (!inCorrected.has(c.index)) continue;
    const key = `${c.before}\u0000${c.after}`;
    const cur = byPair.get(key) ?? { before: c.before, after: c.after, kind: c.kind, indices: [] };
    if (!cur.indices.includes(c.index)) cur.indices.push(c.index);
    byPair.set(key, cur);
  }
  g.correctionGroups = [...byPair.values()].sort((a, b) => b.indices.length - a.indices.length || a.indices[0] - b.indices[0]);
  return g;
}

/** 本人が一つずつ見る所（区切り・話者・相手の数・そのほか）。Claude の直しと本人の直しは数えない（直しは一覧で目を通す） */
export function countToCheck(g: CheckGroups): number {
  return g.unanchored.length + g.speaker.length + g.multiple.length + g.other.length;
}

/** 印の付いた発話のすべて（0 件のときだけ「0 件は聞き違いが無いことの証明ではない」を出す） */
export function countChecks(g: CheckGroups): number {
  return g.unanchored.length + g.speaker.length + g.multiple.length + g.corrected.length + g.edited.length + g.other.length;
}
