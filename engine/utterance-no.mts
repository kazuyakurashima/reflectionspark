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
const SIGN = "[-−–－]";
// 長音の「ー」も区切りに入れる。数字の前の「ー」は範囲の書き方で、外すと「発話 12ー15」の 15 を見落とす
const JOINER = "[〜～~\\-–—−ー・、,，とや→]";
// 数のあとに助数詞が続くものは、発話番号ではない（「発話 3 と 5 つの候補」の 5）。
// 数字も先読みに入れて、「15 つ」を「1」だけ読み取り直さないようにする
const COUNTER = "つ|個|件|回|人|割|分|秒|日|週|年|歳|字|点|か月|ヶ月|時間|%|％";
const NOT_COUNT = `(?![0-9０-９]|\\s*(?:${COUNTER}))`;
// 「発話 12」「発話12」「発話 12〜15」「発話 12・14」「発話 12、発話 14」のまとまり。「発話 -1」も番号の誤りとして読む
const ONE_REF = `発話\\s*${SIGN}?\\s*${NUMBER}${NOT_COUNT}`;
const REF = new RegExp(`${ONE_REF}(?:\\s*${JOINER}\\s*(?:${ONE_REF}|${NUMBER}${NOT_COUNT}))*`, "gu");
const NUMBER_IN_REF = new RegExp(`(?:発話\\s*(${SIGN})\\s*)?(${NUMBER})`, "gu");

// 前回の面談の番号の印。AI が「前回の発話 n」と書いた文も、前回の番号として扱う
const PREVIOUS = "前回の面談の";
const PREVIOUS_MARK = "前回(?:の面談)?の";
const ONE_REF_NOT_MARKED = new RegExp(`(?<!${PREVIOUS_MARK})${ONE_REF}`, "gu");
const REF_NOT_MARKED = new RegExp(`(?<!${PREVIOUS_MARK})${REF.source}`, "gu");

function toNumber(s: string): number {
  return Number(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

function readRefs(text: string, pattern: RegExp): number[] {
  const out: number[] = [];
  for (const m of (text ?? "").matchAll(pattern)) {
    for (const n of m[0].matchAll(NUMBER_IN_REF)) out.push(n[1] ? -toNumber(n[2]) : toNumber(n[2]));
  }
  return out;
}

// 番号の並びの中の一つ：「12」「15〜17」「発話 15〜発話 17」。範囲の区切りは「〜」と横棒の仲間だけ（「・」「、」は並べる区切り）
const RANGE_JOIN = "[〜～~\\-–—−ー]";
const LIST_ITEM = new RegExp(`(${NUMBER})(?:\\s*${RANGE_JOIN}\\s*(?:発話\\s*)?(${NUMBER}))?`, "gu");
/** 範囲を広げるのは、一つの範囲につき 60 発話まで（それより長い範囲は、書き誤りとみて両端だけを取る） */
const MAX_RANGE = 60;

/**
 * 番号の並び（「発話 12、発話 15〜17」「12, 15-17」）を、範囲を広げた番号の並びにする。重ならない昇順。
 * AI が文の外の欄（読みが指す発話など）に書いた番号を読むのに使う。範囲の中にあるかは toUtteranceIndices で確かめる。
 */
export function parseUtteranceList(text: string): number[] {
  const out = new Set<number>();
  for (const m of (text ?? "").matchAll(LIST_ITEM)) {
    const a = toNumber(m[1]);
    const b = m[2] !== undefined ? toNumber(m[2]) : a;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (hi - lo > MAX_RANGE) {
      out.add(lo);
      out.add(hi);
      continue;
    }
    for (let i = lo; i <= hi; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

/** 文の中の「発話 n」「発話 n〜m」を、範囲を広げた番号の並びにする（前の作りの出力で、文の中に番号を書いていたもの）。重ならない昇順 */
export function findUtteranceIndices(text: string): number[] {
  const out = new Set<number>();
  for (const m of (text ?? "").matchAll(REF)) for (const i of parseUtteranceList(m[0])) out.add(i);
  return [...out].sort((x, y) => x - y);
}

/** 文の中の「発話 n」の番号をすべて取る（範囲は両端の番号）。出てきた順 */
export function findUtteranceRefs(text: string): number[] {
  return readRefs(text, REF);
}

/**
 * 前回の面談について書いた文の中の「発話 n」を、「前回の面談の発話 n」に書き換える。
 * 前回の場面の文を、今回の面談の文書（札つき）と一緒に AI に渡すときに使う。
 * 発話番号は面談ごとに 0 から振るので、印が無いと、前回の番号が今回の札の番号と紛れる。
 * 「発話」が書いてある所ごとに付けるので、並べた番号も一度で印が付き、何度かけても同じ文になる。
 */
export function markPreviousUtteranceRefs(text: string): string {
  return (text ?? "").replace(ONE_REF_NOT_MARKED, (m) => `${PREVIOUS}${m}`);
}

export type UtteranceRefCheck = {
  /** 文の中に出てきた、今回の面談の番号の数 */
  total: number;
  /** 発話の並びの範囲に無い番号（番号のずれや、無い発話を指した印） */
  outOfRange: number[];
};

/**
 * AI が書いた文の中の番号が、発話の並びの範囲にあるかを確かめる（記録と評価のため。画面には出さない）。
 * 前回の面談の番号は今回の並びと比べられないので、数えない。
 */
export function checkUtteranceRefs(texts: (string | null | undefined)[], count: number): UtteranceRefCheck {
  const refs = texts.flatMap((t) => readRefs(t ?? "", REF_NOT_MARKED));
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
