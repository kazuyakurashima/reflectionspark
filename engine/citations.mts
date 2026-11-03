// 引用の照合（決まり 1）。画面に出す引用は citations の cited_text だけで、原文（整形後の発話）と完全一致したものだけ。
// document のブロックは「話者：本文」の形で渡す（モデルが話者を知るため）。cited_text はブロックの全文で返るので、
// 話者の前置きを外した本文が、発話の本文と完全一致するかを見る。この照合はテストで守る。

import type Anthropic from "@anthropic-ai/sdk";

import type { Quote, Utterance } from "./types.mts";

export const SPEAKER_SEP = "：";

/** document のブロックの文。発話の本文が無い（当て直せなかった）ときは番号だけ。 */
export function blockText(u: Utterance): string {
  return `${u.speaker}${SPEAKER_SEP}${u.text ?? `（発話 ${u.index} の本文は出せません）`}`;
}

/** 発話の並びから document のブロックの文を作る。順番がそのまま発話番号。 */
export function blockTexts(utterances: Utterance[]): string[] {
  return utterances.map(blockText);
}

/**
 * 1 つの citation を照合する。
 * cited_text は content[start:end] をそのままつないだ文と等しいはず。等しくなければ捨てる。
 * 等しいときは、各ブロックから話者の前置きを外した本文が、発話の本文と完全一致するかを確かめる。
 */
export function verifyCitation(c: Anthropic.CitationContentBlockLocation, utterances: Utterance[]): Quote {
  const start = c.start_block_index;
  const end = c.end_block_index;
  const inRange = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= utterances.length;
  if (!inRange) {
    return { citedText: c.cited_text, text: "", index: start, endIndex: end, verified: false };
  }
  const range = utterances.slice(start, end);
  const expected = range.map(blockText).join("");
  if (c.cited_text !== expected) {
    return { citedText: c.cited_text, text: "", index: start, endIndex: end, verified: false };
  }
  if (range.some((u) => u.text === null)) {
    return { citedText: c.cited_text, text: "", index: start, endIndex: end, verified: false };
  }
  // 本文（話者の前置きを外したもの）。複数ブロックなら改行でつなぐ
  const text = range.map((u) => u.text as string).join("\n");
  return { citedText: c.cited_text, text, index: start, endIndex: end, verified: true };
}

/** 検証済みの引用が、今の発話の本文と一致しているか（評価の軸 1 で再確認するため） */
export function quoteMatchesTranscript(q: Quote, utterances: Utterance[]): boolean {
  if (!q.verified) return false;
  const range = utterances.slice(q.index, q.endIndex);
  if (range.length !== q.endIndex - q.index) return false;
  return q.text === range.map((u) => u.text ?? "").join("\n") && q.citedText === range.map(blockText).join("");
}

/** 同じ発話の引用を 1 つにまとめる（モデルが同じ発話を 2 度引用したとき） */
export function dedupeQuotes(quotes: Quote[]): Quote[] {
  const seen = new Set<string>();
  const out: Quote[] = [];
  for (const q of quotes) {
    const k = `${q.index}-${q.endIndex}-${q.verified}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

/** 引用の前後の相手の発話（アプリが発話番号から取る。AI に書かせない） */
export function neighborsOf(index: number, utterances: Utterance[]): { before: Utterance | null; after: Utterance | null } {
  return { before: utterances[index - 1] ?? null, after: utterances[index + 1] ?? null };
}
