// 画面のための小さな計算。AI を呼ばない。

import type { Transcript, Utterance } from "@/engine/types.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";

/** 最初の一文と残り。「続きを読む」で最初の一文を消して全文を出す（同じ文を二度見せない）。 */
export function splitFirstSentence(text: string): { first: string; rest: string } {
  const m = /^([\s\S]*?[。！？!?])([\s\S]*)$/u.exec(text.trim());
  if (!m) return { first: text.trim(), rest: "" };
  return { first: m[1], rest: m[2].trim() };
}

export type Counts = {
  selfChars: number;
  otherChars: number;
  selfRatio: number;
  /** いちばん長く続けて話した長さ（同じ話者が続いた発話の文字数の合計）とその話者・発話番号 */
  longestRun: { speaker: string; chars: number; from: number; to: number } | null;
};

/** 数えた記録：話した量の比率（文字数）といちばん長く続けて話した長さ。点には入らない。 */
export function countTranscript(t: Transcript): Counts {
  const { self } = SPEAKER_LABELS[t.kind];
  let selfChars = 0;
  let otherChars = 0;
  let longest: Counts["longestRun"] = null;
  let run: { speaker: string; chars: number; from: number; to: number } | null = null;
  for (const u of t.utterances) {
    const n = [...(u.text ?? u.original)].length;
    if (u.speaker === self) selfChars += n;
    else otherChars += n;
    if (run && run.speaker === u.speaker) {
      run.chars += n;
      run.to = u.index;
    } else {
      run = { speaker: u.speaker, chars: n, from: u.index, to: u.index };
    }
    if (!longest || run.chars > longest.chars) longest = { ...run };
  }
  const total = selfChars + otherChars;
  return { selfChars, otherChars, selfRatio: total === 0 ? 0 : selfChars / total, longestRun: longest };
}

/** 引用の前後の発話（アプリが発話番号から取る。決まり 1） */
export function around(t: Transcript, index: number, width = 2): Utterance[] {
  return t.utterances.slice(Math.max(0, index - width), Math.min(t.utterances.length, index + width + 1));
}

/** 本人が画面 1 で直した印（文字列の正本は check-groups.mts） */
export { MARK_EDITED as CHECK_EDITED_BY_USER } from "./check-groups.mts";

/** 倫理チェックの記号（色だけに頼らない） */
export function ethicsMark(level: string): string {
  switch (level) {
    case "問題なし":
      return "○";
    case "判断できない":
      return "—";
    case "確かめてください":
      return "●";
    default:
      return "●";
  }
}
