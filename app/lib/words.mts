// 画面に出す言葉。AI を呼ばない。
// - 画面では「発話」を「発言」と書く（なじみのある言葉にする）。番号そのものは変えない（0 始まりで、AI に渡す札「〔発話 n〕」と同じ数。
//   番号の決まりは engine/utterance-no.mts）。AI に渡す文と札は変えない。
// - AI が書いた文の中の「発話 n」は、画面に出すときに「発言 n」と読み替え、その発言を開ける印にする。
//   読み替えるのは番号の付いた「発話 n」だけで、ほかの文字と「」の中の言葉には手を入れない。

import type { SceneType } from "../../engine/types.mts";

/** 「発言 40」 */
export function refLabel(index: number): string {
  return `発言 ${index}`;
}

/** 「発言 3〜8」（同じ番号なら「発言 3」） */
export function refRangeLabel(from: number, to: number): string {
  return from === to ? refLabel(from) : `発言 ${from}〜${to}`;
}

/** 「発言 3、5、8」 */
export function refListLabel(indices: number[]): string {
  return `発言 ${indices.join("、")}`;
}

/** 場面の種別を、画面に出す言葉にする。場面についての言葉で、人についての言葉にしない（決まり 3） */
export function sceneTypeLabel(type: SceneType): string {
  return type === "よく表れた所" ? "うまくいった場面" : "課題が見えた場面";
}

const NUMBER = "[0-9０-９]+";
// 数のあとに助数詞が続くものは、発言の番号ではない（engine/utterance-no.mts と同じ考え方）
const NOT_COUNT = "(?![0-9０-９]|\\s*(?:つ|個|件|回|人|割|分|秒|日|週|年|歳|字|点|か月|ヶ月|時間|%|％))";
const JOINER = "[〜～~\\-–—−ー・、,，とや→]";
const GROUP = new RegExp(`発話\\s*${NUMBER}${NOT_COUNT}(?:\\s*${JOINER}\\s*(?:発話\\s*)?${NUMBER}${NOT_COUNT})*`, "gu");
const ONE = new RegExp(`(発話\\s*)?(${NUMBER})`, "gu");
// 前回の面談の番号の印（engine/utterance-no.mts と同じ考え方）。発話番号は面談ごとに 0 から振るので、今回の発言に結び付けない
const PREVIOUS = /(?:前回(?:の面談)?の|前の面談の)\s*$/u;

function toNumber(s: string): number {
  return Number(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

export type TextPart = { text: string; index?: undefined } | { text: string; index: number };

/**
 * AI が書いた文を、ふつうの文と、発言の番号の印に分ける。印の text は画面に出す言葉（「発言 42」、続きの番号は「44」）。
 * 発話の並びの範囲に無い番号と、前回の面談の番号は印にせず、言葉だけ読み替える。
 */
export function splitRefs(text: string, count: number): TextPart[] {
  const parts: TextPart[] = [];
  const push = (t: string) => {
    if (t) parts.push({ text: t });
  };
  let last = 0;
  for (const g of (text ?? "").matchAll(GROUP)) {
    push(text.slice(last, g.index));
    const previous = PREVIOUS.test(text.slice(0, g.index));
    let inner = 0;
    for (const m of g[0].matchAll(ONE)) {
      push(g[0].slice(inner, m.index));
      const n = toNumber(m[2]);
      const shown = m[1] ? refLabel(n) : String(n);
      if (!previous && n >= 0 && n < count) parts.push({ text: shown, index: n });
      else push(shown);
      inner = m.index + m[0].length;
    }
    push(g[0].slice(inner));
    last = g.index + g[0].length;
  }
  push((text ?? "").slice(last));
  return parts;
}

/** 印にしない所で、番号の付いた「発話 n」を「発言 n」と読み替える */
export function sayRefs(text: string): string {
  return splitRefs(text, 0)
    .map((p) => p.text)
    .join("");
}
