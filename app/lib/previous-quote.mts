// 画面 5 に出す「前回の発言」。AI を呼ばない。
// 保存してあるのは、行動を決めたときの「次に試せる所」の場面の、照合済みの引用の本文（画面 4 で Spark に入れたもの）。
// 出す前に、その本文を、行動を決めた面談の発話の本文ともう一度完全一致で照らす。一致する発話が無ければ出さない（決まり 1）。
// 引用の本文は、1 発話の本文か、続いた発話の本文を改行でつないだもの（engine/citations.mts の verifyCitation と同じ形）。

import type { Utterance } from "../../engine/types.mts";

export type PreviousQuote = {
  text: string;
  /** 発話番号。同じ本文が 2 か所以上にあるときは、どれかを決められないので null */
  index: number | null;
  /** 話者。一致した所の話者が一人に決まらないときは null */
  speaker: string | null;
};

export function previousQuoteOf(quoteText: string | null | undefined, utterances: Utterance[] | null | undefined): PreviousQuote | null {
  if (!quoteText || !utterances) return null;
  const matches: { start: number; end: number }[] = [];
  for (let i = 0; i < utterances.length; i++) {
    let joined = "";
    for (let j = i; j < utterances.length; j++) {
      const t = utterances[j].text;
      if (t === null) break;
      joined = j === i ? t : `${joined}\n${t}`;
      if (joined === quoteText) {
        matches.push({ start: i, end: j + 1 });
        break;
      }
      if (!quoteText.startsWith(`${joined}\n`)) break;
    }
  }
  if (matches.length === 0) return null;
  const speakers = new Set(matches.flatMap((m) => utterances.slice(m.start, m.end).map((u) => u.speaker)));
  return {
    text: quoteText,
    index: matches.length === 1 ? utterances[matches[0].start].index : null,
    speaker: speakers.size === 1 ? [...speakers][0] : null,
  };
}
