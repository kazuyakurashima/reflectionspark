// 発話番号の決まりを一か所に置く（docs/設計書.md「工程の間で守ること」）。
//
// 発話番号は一つだけ。0 始まりで、次の 3 つは同じ数になる。別の数え方を足さない。
// - 内部の番号：発話の並びの位置（Utterance.index）。citations の start_block_index と同じ。
// - 原文の発話の札：AI に渡す文書の各ブロックの先頭に書く「〔発話 n〕」。AI は自分で数えず、この札の番号で発話を指す。
// - 表示番号：画面に出す「発話 n」。
//
// 札の書き方と、AI が書いた文の中の番号の読み取りは、このファイルの関数だけを使う。
// ブラウザ側（画面）からも読み込むので、Node の機能は使わない。

/** 画面と、AI に渡す文で使う呼び方。「発話 40」 */
export function utteranceLabel(index: number): string {
  return `発話 ${index}`;
}

/** いくつかの発話をまとめて呼ぶ。「発話 3、5、8」 */
export function utteranceListLabel(indices: number[]): string {
  return `発話 ${indices.join("、")}`;
}

/** 続いた発話を呼ぶ。「発話 3〜8」（同じ番号なら「発話 3」） */
export function utteranceRangeLabel(from: number, to: number): string {
  return from === to ? utteranceLabel(from) : `発話 ${from}〜${to}`;
}

/** AI に渡す文書の、各ブロックの先頭に書く札。「〔発話 40〕」 */
export function blockLabel(index: number): string {
  return `〔${utteranceLabel(index)}〕`;
}

/** AI が返した番号を、発話の並びの位置にする。整数で、範囲の中のものだけ。それ以外は null */
export function toUtteranceIndex(no: unknown, count: number): number | null {
  return typeof no === "number" && Number.isInteger(no) && no >= 0 && no < count ? no : null;
}

/** AI が返した番号の並びから、範囲の中のものだけを残す */
export function toUtteranceIndices(nos: unknown[], count: number): number[] {
  return nos.map((n) => toUtteranceIndex(n, count)).filter((n): n is number => n !== null);
}

const NUMBER = "[0-9０-９]+";
const JOINER = "[〜～~\\-–—−ー・、,，とや→]";
// 「発話 12」「発話12」「発話 12〜15」「発話 12・14」「発話 12、発話 14」のまとまり
const REF = new RegExp(`発話\\s*(${NUMBER}(?:\\s*${JOINER}\\s*(?:発話\\s*)?${NUMBER})*)`, "gu");

function toNumber(s: string): number {
  return Number(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

/** 文の中の「発話 n」の番号をすべて取る（範囲は両端の番号）。出てきた順 */
export function findUtteranceRefs(text: string): number[] {
  const out: number[] = [];
  for (const m of (text ?? "").matchAll(REF)) {
    for (const n of m[1].matchAll(new RegExp(NUMBER, "gu"))) out.push(toNumber(n[0]));
  }
  return out;
}

export type UtteranceRefCheck = {
  /** 文の中に出てきた番号の数 */
  total: number;
  /** 発話の並びの範囲に無い番号（番号のずれや、無い発話を指した印） */
  outOfRange: number[];
};

/** AI が書いた文の中の番号が、発話の並びの範囲にあるかを確かめる（記録と評価のため。画面には出さない） */
export function checkUtteranceRefs(texts: (string | null | undefined)[], count: number): UtteranceRefCheck {
  const refs = texts.flatMap((t) => findUtteranceRefs(t ?? ""));
  return { total: refs.length, outOfRange: [...new Set(refs.filter((n) => n < 0 || n >= count))].sort((a, b) => a - b) };
}

/**
 * 引用した発話（index から endIndex の手前まで）と、その直前・直後の発話を、並びから取る。
 * width を広げると、前後をその数だけ足す。前後の発話はアプリが発話番号から取り、AI には書かせない（決まり 1）。
 */
export function utterancesAround<T>(utterances: T[], index: number, endIndex: number, width = 1): T[] {
  const end = Math.max(endIndex, index + 1);
  return utterances.slice(Math.max(0, index - width), Math.min(utterances.length, end + width));
}
