// 記録（Memory）から来た発話を、画面 2 の発話の部品（app/components/UtteranceView.tsx の Island）にそのまま渡せる形にする。
// 見せ方を新しく作らないための橋渡しで、文は変えない（原文のまま）。API は呼ばない。

import { SPEAKER_LABELS } from "../../engine/types.mts";
import type { MeetingKind, PreviousWords, RepeatScene, Transcript, Utterance } from "../../engine/types.mts";

export type Line = { index: number; speaker: string; text: string };

/** 本人の話者の呼び名（と、相手の呼び名）から、場面の種類を決める。島を右（本人）・左（相手）に置くために使う */
export function kindOfSpeakers(selfSpeaker: string, others: string[] = []): MeetingKind {
  const kinds = Object.keys(SPEAKER_LABELS) as MeetingKind[];
  return kinds.find((k) => SPEAKER_LABELS[k].self === selfSpeaker && others.includes(SPEAKER_LABELS[k].other)) ?? kinds.find((k) => SPEAKER_LABELS[k].self === selfSpeaker) ?? "生徒";
}

/** 記録の発話を、発話の部品が読む形にする。工程 0 の直しと推測は記録に無いので、空にする */
export function linesTranscript(kind: MeetingKind, lines: Line[]): Transcript {
  const utterances: Utterance[] = lines.map((l) => ({ index: l.index, speaker: l.speaker, text: l.text, original: l.text, confidence: "高", check: [], memoSpan: null }));
  return { kind, raw: "", utterances, multipleOthers: false, step0b: { proposed: [], applied: [], discarded: [] }, step0c: null };
}

/** 引用と前後の発話を、発話番号の順に 1 本に並べる（同じ番号は引用を残す） */
export function mergeLines(quotes: Line[], neighbors: Line[]): Line[] {
  const quoted = new Set(quotes.map((q) => q.index));
  return [...quotes, ...neighbors.filter((n) => !quoted.has(n.index))].sort((a, b) => a.index - b.index);
}

/** 前の面談の言葉を、直前 → 本人 → 直後の順に並べる。記録に無い行（null）は出さない */
export function previousLines(p: PreviousWords): Line[] {
  return [p.before, p.own, p.after].filter((l): l is Line => l !== null);
}

/** 記録の画面の点の欄に並べるもの（記録の 1 回分の点。memory-read の RecordEntry["scores"] と同じ形の一部） */
export type RecordScoresInput = {
  selfScore: number;
  selfVerdict: string | null;
  aiScaled: number | null;
  aiVerdict: string | null;
};
export type ScoreCell = { label: string; value: string; unit?: "／10" };

/**
 * 記録の画面の点数の欄。自分の点数 → AI の点数（合計）、続きの回は 自分の点数 → 自分の判定 → AI の判定。
 * 続きの回（前回のひとつを確かめた回。判定がある回）は、AI の合計を出さない。
 * サンプルの記録の続きの回の AI の点は、前の作りの画面 4（工程 4）で付けた点で、今の流れで画面 2（工程 2）に出す点とは別のため。
 */
export function recordScoreCells(s: RecordScoresInput): ScoreCell[] {
  const self: ScoreCell = { label: "自分の点数", value: String(s.selfScore), unit: "／10" };
  const followUp = s.selfVerdict !== null || s.aiVerdict !== null;
  if (!followUp) return [self, { label: "AI の点数（合計）", value: s.aiScaled === null ? "—" : String(s.aiScaled), unit: "／10" }];
  return [self, ...(s.selfVerdict ? [{ label: "自分の判定", value: s.selfVerdict }] : []), ...(s.aiVerdict ? [{ label: "AI の判定", value: s.aiVerdict }] : [])];
}

/** 「2025-10-24」→「2025 年 10 月 24 日」。読めない形はそのまま返す */
export function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日` : date;
}

/** 「2025/11/21」の形（画面 3 のカードの小さな日付） */
export function slashDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : date;
}

export function kindLabel(kind: MeetingKind): string {
  return kind === "コーチング" ? "1on1" : `${kind}面談`;
}

/**
 * 同じ形の場面を、画面 3 のカードが読む形にそろえる。11/8 より前に保存した面談は、前の言葉（直前・本人・直後）だけを持つので、
 * 見出し・夢のまとめ・その回の AI の文は空にし、会話はその 3 発話にする（開き直しても画面が壊れないように）
 */
export function repeatSceneView(p: RepeatScene | PreviousWords): RepeatScene {
  const r = p as Partial<RepeatScene> & PreviousWords;
  if (Array.isArray(r.lines) && r.lines.length > 0 && r.kind !== undefined && r.kind in SPEAKER_LABELS) return r as RepeatScene;
  const lines = previousLines(p);
  return {
    ...p,
    kind: kindOfSpeakers(
      p.own.speaker,
      lines.map((l) => l.speaker),
    ),
    title: typeof r.title === "string" ? r.title : null,
    summary: null,
    scene: null,
    lines,
  };
}
