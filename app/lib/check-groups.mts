// 画面 1 の「確かめる所」を種類ごとに分ける。AI を呼ばない。
// 見る必要が高い所（話者・区切り・相手の数）を先に一つずつ出し、聞き違いの直しは同じ直しを 1 行にまとめる。
// 印の文字列は engine/step0.mts の CHECK_* と同じ（画面からサーバーの部品を読み込まないため、ここに写し、テストで一致を守る）。

import type { Correction, Guess, Transcript, Utterance } from "../../engine/types.mts";

export const MARK_SPEAKER_LOW = "話者の確からしさが低い";
export const MARK_SPEAKER_MID = "話者の確からしさが中";
export const MARK_SPEAKER_LABEL = "話者ラベルが読めなかった";
export const MARK_UNANCHORED = "区切りが分からない所";
export const MARK_MULTIPLE = "相手が 2 人以上と推定した";
export const MARK_CORRECTED = "聞き違いを直した所がある";
export const MARK_EDITED = "本人が直した";
/** 本人が話者を確かめた（「合っている」か、話者を選び直した）。画面のための印で、分析には使わない */
export const MARK_SPEAKER_CHECKED = "話者を本人が確かめた";

/** 確かめる所に出すか：話者の確からしさが「中」だけの発話は出さない */
export function needsCheck(u: Utterance): boolean {
  return u.check.some((c) => !c.startsWith(MARK_SPEAKER_MID));
}

/** 話者を確かめる所に出すか。Claude が迷った印は、本人が確かめた後も残すので、確かめた後も同じ所に出る（選び直せるように） */
export function asksSpeaker(u: Utterance): boolean {
  return has(u, MARK_SPEAKER_LOW) || has(u, MARK_SPEAKER_LABEL);
}

export function speakerChecked(u: Utterance): boolean {
  return u.check.includes(MARK_SPEAKER_CHECKED);
}

/**
 * 本人が話者を選ぶ。合っているときは、今の話者を選ぶ。
 * Claude が迷った印は消さずに、確かめた印を付ける（押した発言が確かめる所から消えず、何度でも選び直せる）。話者を替えたときは「本人が直した」も付ける。
 */
export function withSpeaker(u: Utterance, speaker: string): Utterance {
  const changed = speaker !== u.speaker;
  const check = [...u.check.filter((c) => c !== MARK_SPEAKER_CHECKED && c !== MARK_EDITED), MARK_SPEAKER_CHECKED];
  if (changed || u.check.includes(MARK_EDITED)) check.push(MARK_EDITED);
  return { ...u, speaker, confidence: "高", check };
}

export type CorrectionGroup = { before: string; after: string; kind: string; indices: number[] };

export type CheckGroups = {
  /** 区切りが分からない所（本人が分ける） */
  unanchored: Utterance[];
  /** 話者を確かめる所（確からしさが低い、ラベルが読めない） */
  speaker: Utterance[];
  /** 相手が 2 人以上と推定した所 */
  multiple: Utterance[];
  /** 意味が通らず、まだ本文に入っていない推測（0c）がある所 */
  guessed: Utterance[];
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

/** 推測を今の本文に当てた形。target は本文の中で置き換える所（見つからなければ null）、applied は置き換えた後の本文 */
export type GuessView = Guess & { target: string | null; applied: string | null };

const bare = (s: string) => s.replace(/[\s、。,.・]/g, "");

/**
 * 発話に付いた推測（0c）のうち、まだ本文に入っていないもの。
 * 0c は元の文で読むので、0b の直しで既に同じ言葉になっていれば出さない（句読点と空白は見ない）。
 * 置き換える所は、推測の元の言葉そのもの、なければ 0b の直しを当てた形で本文から探す。
 */
export function guessViews(t: Transcript, u: Utterance): GuessView[] {
  const text = u.text ?? "";
  const cs = t.step0b.applied.filter((c) => c.index === u.index);
  const out: GuessView[] = [];
  for (const g of t.step0c?.guesses ?? []) {
    if (g.index !== u.index) continue;
    if (bare(text).includes(bare(g.guess))) continue;
    let target: string | null = null;
    if (g.fragment !== "" && text.includes(g.fragment)) target = g.fragment;
    else {
      const fixed = cs.reduce((s, c) => s.split(c.before).join(c.after), g.fragment);
      if (fixed !== "" && text.includes(fixed)) target = fixed;
    }
    out.push({ ...g, target, applied: target === null ? null : replaceFirst(text, target, g.guess) });
  }
  return out;
}

function replaceFirst(text: string, target: string, by: string): string {
  const i = text.indexOf(target);
  return i < 0 ? text : text.slice(0, i) + by + text.slice(i + target.length);
}

/**
 * 発話を、区切り → 相手の数 → 推測 → 聞き違いの直し → 本人の直し → そのほか の順で、最初に当たった種類に入れる。
 * 話者だけは別に数える：話者を迷った発話は「話者」に入れ、同じ発話の推測と聞き違いの直しは、それぞれの種類にも入れる
 * （話者の所では話者だけを確かめ、言葉の直しを混ぜない）。区切りが分からない発話は、区切りの所だけに入れる。
 */
export function groupChecks(t: Transcript): CheckGroups {
  const g: CheckGroups = { unanchored: [], speaker: [], multiple: [], guessed: [], corrected: [], correctionGroups: [], edited: [], other: [] };
  for (const u of t.utterances) {
    const guessed = guessViews(t, u).length > 0;
    if (!needsCheck(u) && !guessed) continue;
    if (has(u, MARK_UNANCHORED)) {
      g.unanchored.push(u);
      continue;
    }
    const speaker = asksSpeaker(u);
    if (speaker) g.speaker.push(u);
    if (has(u, MARK_MULTIPLE) && !speaker) g.multiple.push(u);
    else if (guessed) g.guessed.push(u);
    else if (has(u, MARK_CORRECTED)) g.corrected.push(u);
    else if (speaker) continue;
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

/** 本人が一つずつ見る所（区切り・話者・相手の数・推測・そのほか）。Claude の直しと本人の直しは数えない（直しは一覧で目を通す） */
export function countToCheck(g: CheckGroups): number {
  return g.unanchored.length + g.speaker.length + g.multiple.length + g.guessed.length + g.other.length;
}

/** 確かめる所の数（0 件のときだけ「0 件は聞き違いが無いことの証明ではない」を出す）。話者と言葉の直しの両方がある発話は、2 つと数える */
export function countChecks(g: CheckGroups): number {
  return g.unanchored.length + g.speaker.length + g.multiple.length + g.guessed.length + g.corrected.length + g.edited.length + g.other.length;
}
