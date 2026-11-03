// 工程 1・4 の本文（citations 付きなので構造化出力は使えない）を、タグの形から読む。
// タグは ASCII の名前。中身はそのまま文字列で返す。位置も返す（citation の区切りをタグに当てるため）。

export type TagMatch = {
  name: string;
  attrs: Record<string, string>;
  inner: string;
  /** 本文全体の中での中身の位置 [start, end)（UTF-16 単位） */
  start: number;
  end: number;
  /** タグ全体の位置 */
  outerStart: number;
  outerEnd: number;
};

/** name のタグをすべて取る。入れ子は想定しない（同じ名前のタグが入れ子になると読み方が崩れる）。 */
export function findTags(text: string, name: string): TagMatch[] {
  const out: TagMatch[] = [];
  const open = new RegExp(`<${name}(\\s[^>]*)?>`, "g");
  let m: RegExpExecArray | null;
  while ((m = open.exec(text)) !== null) {
    const closeIdx = text.indexOf(`</${name}>`, open.lastIndex);
    if (closeIdx === -1) break;
    const attrs: Record<string, string> = {};
    const attrRe = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[1] ?? "")) !== null) attrs[a[1]] = a[2];
    out.push({
      name,
      attrs,
      inner: text.slice(open.lastIndex, closeIdx),
      start: open.lastIndex,
      end: closeIdx,
      outerStart: m.index,
      outerEnd: closeIdx + name.length + 3,
    });
    open.lastIndex = closeIdx + name.length + 3;
  }
  return out;
}

/** 最初の name タグの中身（無ければ空文字）。from/to を渡すとその範囲の中だけで探す。 */
export function tagText(text: string, name: string, from = 0, to = text.length): string {
  const sub = text.slice(from, to);
  const t = findTags(sub, name)[0];
  return t ? t.inner.trim() : "";
}

/** 「1, 2」「1、2」のような番号の並びを読む */
export function parseNumbers(s: string): number[] {
  return [...s.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => Number.isInteger(n));
}
