// 点の控え（②。docs/設計書.md「覚えていると整理」、決まり 10・12）。自己採点と一言、自己評価、AI の点と判定を、記録とは別のメモリストアに置く。
// アプリ（スクリプト）が直接書き、どのセッションにも夢にも付けない。夢は記録と記録係のセッションの中身を読み、夢の出力は工程 3 に渡るので、
// 記録の側に点と判定を入れると、前の回の評価が次の回の AI に届く。読むのは記録の画面（engine/memory-read.mts）だけ。
// ここは純粋な関数だけ。AI の文（判定のなぜ、項目の理由）は置かない。出すのは数字と判定だけ。

import { computeTotal } from "./rubric.mts";
import type { FollowUpVerdict, ItemNumber, ItemScore } from "./types.mts";

/** 本人が付けるもの。続きの回でなければ selfVerdict は null */
export type SelfEntry = { selfScore: number; selfNote: string; selfVerdict: FollowUpVerdict | null };

export type LedgerEntry = SelfEntry & {
  interviewId: string;
  date: string;
  /** AI の点（項目ごと）。判定しない項目は null。合計は読むときにアプリが計算する（決まり 8） */
  aiItems: { item: ItemNumber; score: number | null }[];
  /** AI の判定（続きの回だけ） */
  aiVerdict: FollowUpVerdict | null;
};

const VERDICTS: readonly FollowUpVerdict[] = ["できた", "一部", "まだ", "場面がなかった"];

/** メモリストアの中の、点の控えのファイルの場所（1 回 1 ファイル） */
export function ledgerPath(interviewId: string, date: string): string {
  return `/scores/${date}-${interviewId}.json`;
}

export type LedgerInput = {
  interviewId: string;
  date: string;
  self: SelfEntry;
  /** AI の点。続きの回は工程 4、それ以外は工程 2 のもの */
  aiItems: Pick<ItemScore, "item" | "score">[];
  aiVerdict: FollowUpVerdict | null;
};

export function buildLedgerEntry(input: LedgerInput): LedgerEntry {
  const { selfScore, selfNote, selfVerdict } = input.self;
  if (!Number.isInteger(selfScore) || selfScore < 1 || selfScore > 10) throw new Error(`自己採点は 1〜10 の整数にしてください：${input.interviewId}`);
  // 画面 5 の自己評価と AI の判定は、続きの回にそろって付く
  if ((selfVerdict === null) !== (input.aiVerdict === null)) throw new Error(`自己評価と AI の判定は、続きの回にそろえてください：${input.interviewId}`);
  return {
    interviewId: input.interviewId,
    date: input.date,
    selfScore,
    selfNote: selfNote.trim(),
    selfVerdict,
    aiItems: input.aiItems.map((i) => ({ item: i.item, score: i.score })),
    aiVerdict: input.aiVerdict,
  };
}

export function renderLedgerEntry(e: LedgerEntry): string {
  return `${JSON.stringify(e, null, 2)}\n`;
}

/** 読み返した文を点の控えとして読む。形が合わなければ null（画面に出さない） */
export function parseLedgerEntry(content: string): LedgerEntry | null {
  let v: unknown;
  try {
    v = JSON.parse(content);
  } catch {
    return null;
  }
  const e = v as Partial<LedgerEntry> | null;
  if (!e || typeof e !== "object") return null;
  if (typeof e.interviewId !== "string" || typeof e.date !== "string") return null;
  if (typeof e.selfScore !== "number" || typeof e.selfNote !== "string") return null;
  if (!Array.isArray(e.aiItems)) return null;
  const verdictOk = (x: unknown) => x === null || VERDICTS.includes(x as FollowUpVerdict);
  if (!verdictOk(e.selfVerdict) || !verdictOk(e.aiVerdict)) return null;
  return e as LedgerEntry;
}

/** AI の合計（アプリが計算する。engine/rubric.mts の computeTotal と同じ尺度） */
export function ledgerTotal(e: Pick<LedgerEntry, "aiItems">): ReturnType<typeof computeTotal> {
  return computeTotal(e.aiItems.map((i) => ({ ...i, reason: "", utterances: [] })));
}
