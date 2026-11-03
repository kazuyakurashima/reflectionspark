// ボイスメモの文字起こし（話者の無い 1 本の文）と、台本（1 行 1 発話）の対応付け。
// 評価の軸 11・12 と「文字起こしに無い行」（docs/設計書.md「読み方と決まり」）で使う。
//
// やり方：両方をゆるく正規化（engine/text.mts）し、文字単位の大域整列（Needleman–Wunsch）で
// 台本の各文字をボイスメモの文字に対応させる。台本の行ごとに、一致した文字の割合を出し、
// 割合が低い行を「文字起こしに無い」と印を付ける。
// 発話（工程 0a の出力）は、ボイスメモでの位置から、重なる台本の行に写す。

import { normalizeLoose } from "../../engine/text.mts";
import type { Normalized } from "../../engine/text.mts";

export type ScriptLine = {
  /** 台本の行番号（1 始まり） */
  line: number;
  speaker: string;
  text: string;
};

/** 台本（「話者名：本文」が 1 行ずつ）を読む。空行と # の行は飛ばすが、行番号はファイルの行のまま。 */
export function parseScript(source: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  source
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const t = raw.trim();
      if (t === "" || t.startsWith("#")) return;
      const colon = t.search(/[：:]/);
      if (colon === -1) throw new Error(`${i + 1} 行目：「話者名：本文」の形になっていません`);
      out.push({ line: i + 1, speaker: t.slice(0, colon).trim(), text: t.slice(colon + 1).trim() });
    });
  return out;
}

export type LineAlignment = {
  line: number;
  speaker: string;
  text: string;
  /** 正規化後の台本の文字数 */
  chars: number;
  /** ボイスメモの同じ文字と対応した文字数 */
  matched: number;
  /** matched / chars */
  matchRatio: number;
  /** ボイスメモでの範囲（元の文字列のコードポイント位置。[start, end)）。対応が無ければ null */
  memoSpan: [number, number] | null;
  /** 文字起こしに無い行か（matchRatio が閾値未満） */
  missing: boolean;
};

export type Alignment = {
  lines: LineAlignment[];
  /** ボイスメモの正規化後の各文字が、台本のどの行に対応するか（-1 は対応なし） */
  memoCharLine: Int32Array;
  /** ボイスメモの正規化後の各文字が、台本の正規化後のどの文字に対応するか（-1 は対応なし） */
  memoCharScript: Int32Array;
  /** 対応した文字が同じ文字だったか（聞き違いの位置を知るため） */
  memoCharSame: Uint8Array;
  /** 台本の正規化後の文字の並び（行をつないだもの）と、各文字の行（lines の添字） */
  scriptChars: string[];
  scriptCharLine: Int32Array;
  memo: Normalized;
  /** 文字起こしに無い行の番号 */
  missingLines: number[];
  /** 判定に使った閾値 */
  threshold: number;
};

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;

/** 台本とボイスメモを対応付ける。threshold は「ある」と見なす一致の割合の下限。 */
export function alignScriptToMemo(script: ScriptLine[], memoText: string, threshold = 0.4): Alignment {
  const memo = normalizeLoose(memoText);
  // 台本の正規化後の文字の並びと、各文字がどの行か
  const sChars: string[] = [];
  const sLine: number[] = [];
  const lineIndex = new Map<number, number>();
  script.forEach((l, li) => {
    lineIndex.set(l.line, li);
    for (const c of normalizeLoose(l.text).chars) {
      sChars.push(c);
      sLine.push(li);
    }
  });
  const m = sChars.length;
  const n = memo.chars.length;

  // 大域整列（線形のギャップ）。traceback 用に向きだけを持つ。
  // 0: 対角（一致か不一致） 1: 上（台本の文字をギャップに） 2: 左（ボイスメモの文字をギャップに）
  const W = n + 1;
  const dir = new Uint8Array((m + 1) * W);
  let prev = new Int32Array(W);
  let cur = new Int32Array(W);
  for (let j = 0; j <= n; j++) {
    prev[j] = j * GAP;
    dir[j] = 2;
  }
  for (let i = 1; i <= m; i++) {
    cur[0] = i * GAP;
    dir[i * W] = 1;
    const sc = sChars[i - 1];
    for (let j = 1; j <= n; j++) {
      const diag = prev[j - 1] + (sc === memo.chars[j - 1] ? MATCH : MISMATCH);
      const up = prev[j] + GAP;
      const left = cur[j - 1] + GAP;
      if (diag >= up && diag >= left) {
        cur[j] = diag;
        dir[i * W + j] = 0;
      } else if (up >= left) {
        cur[j] = up;
        dir[i * W + j] = 1;
      } else {
        cur[j] = left;
        dir[i * W + j] = 2;
      }
    }
    [prev, cur] = [cur, prev];
  }

  // traceback
  const memoCharLine = new Int32Array(n).fill(-1);
  const memoCharScript = new Int32Array(n).fill(-1);
  const memoCharSame = new Uint8Array(n);
  const matchedPerLine = new Int32Array(script.length);
  const spanMin = new Int32Array(script.length).fill(-1);
  const spanMax = new Int32Array(script.length).fill(-1);
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const d = i === 0 ? 2 : j === 0 ? 1 : dir[i * W + j];
    if (d === 0) {
      const li = sLine[i - 1];
      const same = sChars[i - 1] === memo.chars[j - 1];
      if (same) matchedPerLine[li]++;
      // 不一致の文字も、その行の範囲には入れる（聞き違いの位置）
      memoCharLine[j - 1] = li;
      memoCharScript[j - 1] = i - 1;
      memoCharSame[j - 1] = same ? 1 : 0;
      const pos = memo.index[j - 1];
      if (spanMin[li] === -1 || pos < spanMin[li]) spanMin[li] = pos;
      if (pos + 1 > spanMax[li]) spanMax[li] = pos + 1;
      i--;
      j--;
    } else if (d === 1) {
      i--;
    } else {
      j--;
    }
  }

  const lines: LineAlignment[] = script.map((l, li) => {
    const chars = normalizeLoose(l.text).chars.length;
    const matched = matchedPerLine[li];
    const matchRatio = chars === 0 ? 0 : matched / chars;
    // 3 字以下の短い行（「はい。」など）は、全部の文字が合ったときだけ「ある」とする
    const missing = matchRatio < threshold || (chars <= 3 && matched < chars);
    return {
      line: l.line,
      speaker: l.speaker,
      text: l.text,
      chars,
      matched,
      matchRatio,
      memoSpan: missing || spanMin[li] === -1 ? null : [spanMin[li], spanMax[li]],
      missing,
    };
  });
  // 無い行に付いてしまった文字は、対応なしに戻す
  for (let k = 0; k < n; k++) {
    const li = memoCharLine[k];
    if (li >= 0 && lines[li].missing) {
      memoCharLine[k] = -1;
      memoCharScript[k] = -1;
      memoCharSame[k] = 0;
    }
  }
  return {
    lines,
    memoCharLine,
    memoCharScript,
    memoCharSame,
    scriptChars: sChars,
    scriptCharLine: Int32Array.from(sLine),
    memo,
    missingLines: lines.filter((l) => l.missing).map((l) => l.line),
    threshold,
  };
}

/**
 * ボイスメモの範囲 [start, end)（元の文字列のコードポイント位置）が、台本のどの行に重なるかを数える。
 * 返すのは行番号ごとの対応した文字数（多い順）。
 */
export function linesForMemoSpan(a: Alignment, start: number, end: number): { line: number; chars: number }[] {
  const counts = new Map<number, number>();
  for (let k = 0; k < a.memo.index.length; k++) {
    const pos = a.memo.index[k];
    if (pos < start) continue;
    if (pos >= end) break;
    const li = a.memoCharLine[k];
    if (li < 0) continue;
    const line = a.lines[li].line;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.entries()].map(([line, chars]) => ({ line, chars })).sort((x, y) => y.chars - x.chars);
}

/** 台本の行番号から、その行の話者を返す。 */
export function speakerOfLine(script: ScriptLine[], line: number): string | undefined {
  return script.find((l) => l.line === line)?.speaker;
}

/**
 * 作り手の注記（eval/cases/<case>/missing-lines.json）で「文字起こしに無い」と分かっている行を、対応付けの結果に足す。
 * 対応付けだけでは断片が残って「ある」と出る行があるため。
 */
export function addKnownMissing(a: Alignment, lines: number[]): Alignment {
  const set = new Set(lines);
  for (let li = 0; li < a.lines.length; li++) {
    const l = a.lines[li];
    if (!set.has(l.line) || l.missing) continue;
    l.missing = true;
    l.memoSpan = null;
    for (let k = 0; k < a.memoCharLine.length; k++) {
      if (a.memoCharLine[k] === li) {
        a.memoCharLine[k] = -1;
        a.memoCharScript[k] = -1;
        a.memoCharSame[k] = 0;
      }
    }
  }
  a.missingLines = a.lines.filter((l) => l.missing).map((l) => l.line);
  return a;
}

/** 正解の範囲（行番号の並び）から、文字起こしに無い行を除く。 */
export function dropMissingLines(lines: number[], a: Alignment): { kept: number[]; dropped: number[] } {
  const missing = new Set(a.missingLines);
  const kept: number[] = [];
  const dropped: number[] = [];
  for (const l of lines) (missing.has(l) ? dropped : kept).push(l);
  return { kept, dropped };
}

/**
 * ボイスメモの範囲 [start, end)（元の文字列の位置）に対応する、台本の正規化後の文字の範囲を返す。
 * margin の分だけ前後に広げる。対応が無ければ null。
 */
export function scriptWindowForMemoSpan(a: Alignment, start: number, end: number, margin = 3): { chars: string[]; from: number; to: number } | null {
  let lo = -1;
  let hi = -1;
  for (let k = 0; k < a.memo.index.length; k++) {
    const pos = a.memo.index[k];
    if (pos < start) continue;
    if (pos >= end) break;
    const si = a.memoCharScript[k];
    if (si < 0) continue;
    if (lo === -1 || si < lo) lo = si;
    if (si > hi) hi = si;
  }
  if (lo === -1) return null;
  const from = Math.max(0, lo - margin);
  const to = Math.min(a.scriptChars.length, hi + 1 + margin);
  return { chars: a.scriptChars.slice(from, to), from, to };
}

/**
 * ボイスメモの中で、台本と食い違う所（聞き違いの位置）を、元の文字列の範囲の並びで返す。
 * 連続する不一致（間に 1 字の一致があっても続きとみなす）を 1 か所にまとめる。
 * 文字起こしに無い行に対応する所（対応なし）は数えない。
 */
export function mismatchSpots(a: Alignment): { start: number; end: number; memoText: string; line: number }[] {
  const spots: { start: number; end: number; memoText: string; line: number }[] = [];
  const n = a.memo.index.length;
  let k = 0;
  while (k < n) {
    if (a.memoCharLine[k] >= 0 && a.memoCharSame[k] === 0) {
      const s = k;
      let e = k;
      let j = k + 1;
      while (j < n && a.memoCharLine[j] >= 0) {
        if (a.memoCharSame[j] === 0) {
          e = j;
          j++;
        } else if (j + 1 < n && a.memoCharLine[j + 1] >= 0 && a.memoCharSame[j + 1] === 0) {
          j++;
        } else break;
      }
      const start = a.memo.index[s];
      const end = a.memo.index[e] + 1;
      spots.push({ start, end, memoText: a.memo.original.slice(start, end).join(""), line: a.lines[a.memoCharLine[s]].line });
      k = e + 1;
    } else k++;
  }
  return spots;
}
