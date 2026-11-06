// 決まり 3：人物の性質を言い表す言葉、優劣、「〜すべき」の断定を、AI の出力から検出する。
// 評価の軸 5（0 件を保つ）と、アプリでの検査に使う。
// 原文の引用（cited_text）は検査しない（相手や本人が言った言葉はそのまま）。

export type ForbiddenHit = {
  /** 当たった言葉 */
  word: string;
  /** 見つかった欄の名前 */
  field: string;
  /** 前後の文 */
  context: string;
};

/** 人物の性質・優劣・断定の言葉。正規表現で持つ。 */
export const FORBIDDEN_PATTERNS: { word: string; re: RegExp }[] = [
  { word: "性格", re: /性格/g },
  { word: "タイプ", re: /タイプ/g },
  { word: "癖", re: /癖/g },
  { word: "傾向", re: /傾向/g },
  { word: "〜な人", re: /な人/g },
  { word: "〜する人", re: /(?:する|しない|できる|できない|しがちな|しやすい|しにくい)人/g },
  { word: "〜しがち", re: /しがち/g },
  { word: "〜べき", re: /べき/g },
  { word: "優れ", re: /優れ/g },
  { word: "劣", re: /劣[るっり]/g },
  { word: "苦手な講師", re: /苦手な(?:講師|先生|コーチ|人)/g },
  { word: "得意な講師", re: /得意な(?:講師|先生|コーチ|人)/g },
  { word: "できていない講師", re: /(?:できていない|できない|できる)(?:講師|先生|コーチ)/g },
  { word: "〜癖がある", re: /癖がある/g },
  { word: "いつも", re: /いつも(?:の|、)?(?:ように)?(?:講師|先生|コーチ|本人|あなた)/g },
  // 教科や問題の話（「数学の性質」「関数の性質」）は人の話ではないので当てない。それ以外は当てる（決まり 3 を緩めない）
  { word: "性質", re: /(?<!(?:数学|算数|英語|国語|理科|社会|物理|化学|生物|地学|歴史|地理|教科|科目|単元|問題|関数|方程式|図形|文法|試験|テスト)の)性質/g },
  { word: "人柄", re: /人柄/g },
  { word: "気質", re: /気質/g },
];

/**
 * 1 つの欄の文を検査する。
 * 「〜な人」のような語は、引用符の中（相手や本人の言葉）には当てない。
 */
export function scanText(text: string, field: string): ForbiddenHit[] {
  if (!text) return [];
  // 「」『』の中は検査しない（言った言葉をそのまま書いた所）
  const stripped = text.replace(/「[^」]*」/g, (m) => "　".repeat([...m].length)).replace(/『[^』]*』/g, (m) => "　".repeat([...m].length));
  const hits: ForbiddenHit[] = [];
  for (const { word, re } of FORBIDDEN_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      const start = Math.max(0, m.index - 12);
      const end = Math.min(stripped.length, m.index + m[0].length + 12);
      hits.push({ word, field, context: text.slice(start, end) });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return hits;
}

/**
 * 出力のオブジェクトを深く辿り、文字列の欄をすべて検査する。
 * skipKeys の欄（cited_text、original など、原文をそのまま持つ所）は飛ばす。
 */
export function scanObject(obj: unknown, skipKeys: string[] = ["cited_text", "citedText", "original", "text", "before", "after", "fragment", "quote"], prefix = ""): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  const skip = new Set(skipKeys);
  const walk = (v: unknown, p: string) => {
    if (typeof v === "string") {
      hits.push(...scanText(v, p || "(root)"));
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (skip.has(k)) continue;
        walk(x, p ? `${p}.${k}` : k);
      }
    }
  };
  walk(obj, prefix);
  return hits;
}
