// 台本の読み取りと、1 回に送る分への分け方。
// 台本は 1 行 1 発話・「話者名：本文」。空行と「#」で始まる行は飛ばす。
// 本文は手を加えずに渡す（[hesitates] などの演技の指示もそのまま）。

export type Utterance = {
  /** 台本ファイルでの行番号（1 始まり） */
  line: number;
  speaker: string;
  text: string;
};

export type Chunk = {
  utterances: Utterance[];
  /** 本文の文字数の合計 */
  chars: number;
  /** この回に出てくる話者（出てくる順） */
  speakers: string[];
};

/** 1 回に送れる声の数の上限（ElevenLabs Text to Dialogue） */
export const MAX_VOICES_PER_REQUEST = 10;

/** 文字数。サロゲートペアを 1 字と数える。 */
export function countChars(text: string): number {
  return [...text].length;
}

/** 台本の文を発話の並びにする。形の合わない行があれば、行番号を添えてまとめて投げる。 */
export function parseDialogue(source: string): Utterance[] {
  const utterances: Utterance[] = [];
  const problems: string[] = [];
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;

    const colon = trimmed.search(/[：:]/);
    if (colon === -1) {
      problems.push(`${line} 行目：「話者名：本文」の形になっていません（${preview(trimmed)}）`);
      return;
    }
    const speaker = trimmed.slice(0, colon).trim();
    const text = trimmed.slice(colon + 1).trim();
    if (speaker === "") {
      problems.push(`${line} 行目：話者名がありません（${preview(trimmed)}）`);
      return;
    }
    if (text === "") {
      problems.push(`${line} 行目：本文がありません（${preview(trimmed)}）`);
      return;
    }
    utterances.push({ line, speaker, text });
  });

  if (problems.length > 0) {
    throw new Error(`台本に直す所があります。\n${problems.join("\n")}`);
  }
  if (utterances.length === 0) {
    throw new Error("台本に発話が 1 つもありません。");
  }
  return utterances;
}

/**
 * 発話の切れ目で、1 回に送る分に分ける。発話の途中では切らず、順番も変えない。
 * 1 回の文字数は maxChars まで、話者は MAX_VOICES_PER_REQUEST まで。
 * 回数はできるだけ少なくし、その回数の中で 1 回あたりの文字数がなるべくそろうように分ける
 * （最後の回だけが短く残ると、そこだけ前後の流れが薄くなるため）。
 * 1 発話だけで maxChars を超えるときは、分けずに投げる（台本の側でその行を分けてもらう）。
 */
export function splitIntoChunks(utterances: Utterance[], maxChars: number): Chunk[] {
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error(`1 回に送る文字数の上限が正しくありません（${maxChars}）`);
  }
  const tooLong = utterances.filter((u) => countChars(u.text) > maxChars);
  if (tooLong.length > 0) {
    const list = tooLong
      .map((u) => `${u.line} 行目（${countChars(u.text)} 字）`)
      .join("、");
    throw new Error(
      `1 回に送れる ${maxChars} 字を 1 発話だけで超えています：${list}。台本でその行を 2 つ以上の行に分けてください。`,
    );
  }

  // 上限いっぱいに前から詰めたときの回数が、いちばん少ない回数。
  // その回数に収まる中でいちばん小さい上限を二分探索で探し、その上限で前から詰める。
  const count = packGreedy(utterances, maxChars).length;
  let low = Math.max(
    Math.ceil(utterances.reduce((sum, u) => sum + countChars(u.text), 0) / count),
    ...utterances.map((u) => countChars(u.text)),
  );
  let high = maxChars;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (packGreedy(utterances, mid).length <= count) high = mid;
    else low = mid + 1;
  }
  return packGreedy(utterances, high);
}

/** 上限 cap まで前から順に詰める。 */
function packGreedy(utterances: Utterance[], cap: number): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk | undefined;

  for (const u of utterances) {
    if (current === undefined || !fits(current, u, cap)) {
      current = { utterances: [], chars: 0, speakers: [] };
      chunks.push(current);
    }
    current.utterances.push(u);
    current.chars += countChars(u.text);
    if (!current.speakers.includes(u.speaker)) current.speakers.push(u.speaker);
  }
  return chunks;
}

function fits(chunk: Chunk, u: Utterance, maxChars: number): boolean {
  if (chunk.chars + countChars(u.text) > maxChars) return false;
  const addsSpeaker = !chunk.speakers.includes(u.speaker);
  return !addsSpeaker || chunk.speakers.length < MAX_VOICES_PER_REQUEST;
}

function preview(text: string): string {
  const chars = [...text];
  return chars.length > 20 ? `${chars.slice(0, 20).join("")}…` : text;
}
