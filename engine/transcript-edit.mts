// 画面 1 で本人が整形の結果を直すための操作。発話を分ける（区切りが分からない所を本人が分ける）。
// 発話番号を振り直し、直しの一覧と推測の発話番号も付け替える。元の文は残す。

import { CHECK_UNANCHORED } from "./step0.mts";
import type { Correction, DiscardedCorrection, Guess, Transcript, Utterance } from "./types.mts";
import { SPEAKER_LABELS } from "./types.mts";

export const CHECK_SPLIT_BY_USER = "本人が分けた";
export const CHECK_ORIGINAL_SAME_AS_TEXT = "分けた後の元の文は本文と同じ（直した所があったため、元の文を分けられなかった）";

function trimSpan(cps: string[], s: number, e: number): [number, number] {
  while (s < e && /\s/.test(cps[s])) s++;
  while (e > s && /\s/.test(cps[e - 1])) e--;
  return [s, e];
}

/**
 * 発話 index を、本文の pos 文字目（コードポイント）で 2 つに分ける。
 * 分けた前半は元の話者、後半はもう一方の話者にする（本人が画面で直せる）。
 * 前半か後半が空になるときは何もしない。
 */
export function splitUtterance(t: Transcript, index: number, pos: number): Transcript {
  const u = t.utterances[index];
  if (!u) return t;
  const text = [...(u.text ?? u.original)];
  if (pos <= 0 || pos >= text.length) return t;
  const [a0, a1] = trimSpan(text, 0, pos);
  const [b0, b1] = trimSpan(text, pos, text.length);
  if (a0 >= a1 || b0 >= b1) return t;
  const firstText = text.slice(a0, a1).join("");
  const secondText = text.slice(b0, b1).join("");
  const { self, other } = SPEAKER_LABELS[t.kind];
  const otherSpeaker = u.speaker === self ? other : self;
  const baseCheck = u.check.filter((c) => !c.startsWith(CHECK_UNANCHORED) && c !== CHECK_SPLIT_BY_USER);
  let first: Utterance;
  let second: Utterance;
  if (u.text === u.original && u.memoSpan) {
    const s0 = u.memoSpan[0];
    first = { ...u, text: firstText, original: firstText, check: [...baseCheck, CHECK_SPLIT_BY_USER], memoSpan: [s0 + a0, s0 + a1] };
    second = { ...u, speaker: otherSpeaker, text: secondText, original: secondText, check: [...baseCheck, CHECK_SPLIT_BY_USER], memoSpan: [s0 + b0, s0 + b1] };
  } else if (u.text === u.original) {
    first = { ...u, text: firstText, original: firstText, check: [...baseCheck, CHECK_SPLIT_BY_USER], memoSpan: null };
    second = { ...u, speaker: otherSpeaker, text: secondText, original: secondText, check: [...baseCheck, CHECK_SPLIT_BY_USER], memoSpan: null };
  } else {
    // 直した所がある発話は、元の文を同じ位置で分けられない。前半に元の文を残し、後半は本文を元の文にして印を付ける
    first = { ...u, text: firstText, check: [...baseCheck, CHECK_SPLIT_BY_USER] };
    second = { ...u, speaker: otherSpeaker, text: secondText, original: secondText, check: [...baseCheck, CHECK_SPLIT_BY_USER, CHECK_ORIGINAL_SAME_AS_TEXT], memoSpan: null };
  }
  const utterances = [...t.utterances.slice(0, index), first, second, ...t.utterances.slice(index + 1)].map((x, i) => ({ ...x, index: i }));
  const remap = (i: number, needle: string): number => {
    if (i < index) return i;
    if (i > index) return i + 1;
    if (firstText.includes(needle)) return index;
    if (secondText.includes(needle)) return index + 1;
    return index;
  };
  const mapCorrection = <C extends Correction | DiscardedCorrection>(c: C): C => ({ ...c, index: remap(c.index, c.before) });
  const mapGuess = (g: Guess): Guess => ({ ...g, index: remap(g.index, g.fragment) });
  return {
    ...t,
    utterances,
    step0b: { ...t.step0b, proposed: t.step0b.proposed.map(mapCorrection), applied: t.step0b.applied.map(mapCorrection), discarded: t.step0b.discarded.map(mapCorrection) },
    step0c: t.step0c ? { ...t.step0c, guesses: t.step0c.guesses.map(mapGuess) } : t.step0c,
  };
}
