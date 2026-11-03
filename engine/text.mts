// 文字列の正規化と照合の部品。
// 引用の照合（決まり 1）は「完全一致」で行う。ここにある「ゆるい一致」は、
// 評価スクリプトで文字起こしと台本を対応付けるときと、工程 0 の出力を元の文に当て直すときにだけ使う。

/** 文字数。サロゲートペアを 1 字と数える。 */
export function countChars(text: string): number {
  return [...text].length;
}

/** 空白と改行をすべて除く。 */
export function stripSpaces(text: string): string {
  return text.replace(/[\s　]+/g, "");
}

const PUNCT = /[\s　。、，．,.?？!！「」『』（）()［］\[\]｛｝{}〈〉《》【】…‥・:：;；"'“”‘’\-—–ー〜~～]/u;

export type Normalized = {
  /** 正規化後の文字の並び */
  chars: string[];
  /** 正規化後の各文字が、元の文字列（コードポイント単位）のどこにあったか */
  index: number[];
  /** 元の文字列をコードポイントで分けたもの */
  original: string[];
};

/**
 * ゆるい照合のための正規化。NFKC にし、空白と句読点・記号を除き、英字を小文字にする。
 * かな・漢字はそのまま。元の文字位置への対応を残す。
 * 注意：長音「ー」も除く（文字起こしで伸ばし棒の有無が揺れるため）。
 */
export function normalizeLoose(text: string): Normalized {
  const original = [...text];
  const chars: string[] = [];
  const index: number[] = [];
  original.forEach((ch, i) => {
    const n = ch.normalize("NFKC").toLowerCase();
    for (const c of n) {
      if (PUNCT.test(c)) continue;
      chars.push(c);
      index.push(i);
    }
  });
  return { chars, index, original };
}

/** 正規化した文字列（照合のキー） */
export function looseKey(text: string): string {
  return normalizeLoose(text).chars.join("");
}

/** 2 つの文字列が、ゆるい正規化の後で同じか */
export function looseEquals(a: string, b: string): boolean {
  return looseKey(a) === looseKey(b);
}

/** 編集距離（レーベンシュタイン）。配列どうし。 */
export function editDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** 0〜1 の近さ（1 が同じ）。ゆるい正規化の後で測る。 */
export function similarity(a: string, b: string): number {
  const na = normalizeLoose(a).chars;
  const nb = normalizeLoose(b).chars;
  const len = Math.max(na.length, nb.length);
  if (len === 0) return 1;
  return 1 - editDistance(na, nb) / len;
}

/**
 * 文字列 hay の中から、needle にいちばん近い部分（ゆるい正規化の後）を、from 以降で探す。
 * 返すのは、正規化後の位置ではなく、元の hay での [start, end)（コードポイント単位）。
 * 見つからなければ null。threshold は近さの下限（0〜1）。
 */
export function findLoose(
  hay: Normalized,
  needle: string,
  from = 0,
  threshold = 0.6,
): { start: number; end: number; score: number } | null {
  const nd = normalizeLoose(needle).chars;
  if (nd.length === 0) return null;
  const hc = hay.chars;
  // from（元の位置）以降の正規化位置
  let h0 = 0;
  while (h0 < hay.index.length && hay.index[h0] < from) h0++;
  if (h0 >= hc.length) return null;

  // まず完全一致（正規化後）を試す
  const key = nd.join("");
  const hayKey = hc.slice(h0).join("");
  const exact = hayKey.indexOf(key);
  if (exact >= 0) {
    // 文字列の index は UTF-16 単位。chars は 1 文字ずつなので、コードポイント数に直す
    const cpOffset = [...hayKey.slice(0, exact)].length;
    const s = h0 + cpOffset;
    const e = s + nd.length;
    return { start: hay.index[s], end: hay.index[e - 1] + 1, score: 1 };
  }

  // 近い部分を窓で探す（窓の長さを needle の 0.7〜1.3 倍で振る）
  let best: { start: number; end: number; score: number } | null = null;
  const minLen = Math.max(1, Math.floor(nd.length * 0.7));
  const maxLen = Math.ceil(nd.length * 1.3);
  const limit = Math.min(hc.length, h0 + Math.max(2000, nd.length * 40));
  for (let s = h0; s < limit; s++) {
    for (let len = minLen; len <= maxLen && s + len <= hc.length; len++) {
      // 速さのため、先頭か末尾の 2 字のどちらかが合うときだけ測る
      if (
        hc[s] !== nd[0] &&
        hc[s + len - 1] !== nd[nd.length - 1] &&
        !(len > 2 && hc[s + 1] === nd[1])
      ) {
        continue;
      }
      const d = editDistance(hc.slice(s, s + len), nd);
      const score = 1 - d / Math.max(len, nd.length);
      if (score >= threshold && (best === null || score > best.score)) {
        best = { start: hay.index[s], end: hay.index[s + len - 1] + 1, score };
      }
    }
    if (best && best.score === 1) break;
  }
  return best;
}
