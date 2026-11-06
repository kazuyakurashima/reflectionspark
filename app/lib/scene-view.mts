// 画面 2 の場面と地図のための小さな計算。AI を呼ばない。
// - 場面に並べる発話の範囲：引用した発話（照合済み）のうち、最初の引用とつながっているひと続き。
//   その直前と直後の発話はアプリが発話番号から足す（AI には書かせない。決まり 1）。
// - 地図の区切り：工程 1 の「面談の流れ」の文の末尾にある発話番号の範囲を読む。読めなければ区切りを出さない。

import type { Quote } from "../../engine/types.mts";
import { findUtteranceRefs } from "../../engine/utterance-no.mts";

export type SceneSpan = {
  /** ひと続きの引用の最初の発話番号 */
  from: number;
  /** ひと続きの引用の最後の発話番号（含む） */
  to: number;
  /** AI が最初に引用した発話。画面でいちばん目立たせる */
  focal: number;
  /** この場面で引用した発話の番号（照合済みのものだけ） */
  quoted: number[];
};

/** 場面の引用から、画面に並べる範囲を決める。照合済みの引用が無ければ null */
export function sceneSpan(quotes: Pick<Quote, "index" | "endIndex" | "verified">[], count: number): SceneSpan | null {
  const set = new Set<number>();
  let focal: number | null = null;
  for (const q of quotes) {
    if (!q.verified) continue;
    const end = Math.max(q.endIndex, q.index + 1);
    for (let i = q.index; i < end; i++) {
      if (i < 0 || i >= count) continue;
      set.add(i);
      if (focal === null) focal = i;
    }
  }
  if (focal === null) return null;
  let from = focal;
  let to = focal;
  while (set.has(from - 1)) from--;
  while (set.has(to + 1)) to++;
  return { from, to, focal, quoted: [...set].sort((a, b) => a - b) };
}

/** 範囲とその前後 width 発話の、最初と最後の番号（含む） */
export function spanWindow(span: Pick<SceneSpan, "from" | "to">, count: number, width: number): { from: number; to: number } {
  return { from: Math.max(0, span.from - width), to: Math.min(count - 1, span.to + width) };
}

/**
 * 「前後をもう少し読む」で並べる範囲。前後 3 発話に加えて、AI が場面の文の中で番号で触れた発話のうち、
 * 場面の近く（前後 near 発話まで）にあるものが入るところまで広げる。文で触れた発話を、その場で原文で確かめられるようにするため。
 */
export function wideWindow(span: Pick<SceneSpan, "from" | "to">, refs: number[], count: number, near = 10): { from: number; to: number } {
  const base = spanWindow(span, count, 3);
  const close = refs.filter((i) => Number.isInteger(i) && i >= Math.max(0, span.from - near) && i <= Math.min(count - 1, span.to + near));
  return { from: Math.min(base.from, ...close), to: Math.max(base.to, ...close) };
}

export type Chapter = { from: number; to: number; text: string };

/**
 * 「面談の流れ」の各文の末尾の「（発話 a〜b）」を読んで、地図の区切りにする。
 * 一つでも読めない・範囲の外・順番が前後するものがあれば、区切りは出さない（空を返す）。推し量って線を引かない。
 */
export function chaptersOf(flow: string[], count: number): Chapter[] {
  const out: Chapter[] = [];
  for (const line of flow) {
    const m = /^([\s\S]*?)[（(]([^（）()]*)[）)]\s*$/u.exec(line.trim());
    if (!m) return [];
    const refs = findUtteranceRefs(m[2]);
    if (refs.length === 0) return [];
    const from = Math.min(...refs);
    const to = Math.max(...refs);
    const prev = out[out.length - 1];
    if (from < 0 || to >= count || (prev && from <= prev.to)) return [];
    out.push({ from, to, text: m[1].trim() });
  }
  return out;
}

/** その発話が入っている区切りの番号（0 始まり）。無ければ -1 */
export function chapterIndexOf(chapters: Chapter[], index: number): number {
  return chapters.findIndex((c) => index >= c.from && index <= c.to);
}
