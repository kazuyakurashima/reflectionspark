// 記録の保存を確かめた結果を、後ろの工程（次の面談の記録、夢）を止める条件にする（docs/設計書.md 工程 5・6）。
// ここは純粋な関数だけ。呼ぶのは scripts/memory/run.mts。
// - 記録は、読み返して「渡した文と同じ」「性質の言葉と名前が無い」「索引に行がある」と確かめるまで、済みにしない。
// - 夢は、全部の面談が済みで、索引も合っているときだけ始める。
// - 本人が直した記録のセッションは、夢に渡さない（直す前の本文が残っているため）。

import { recordPath } from "./memory-record.mts";
import type { StoredFile, StoredRecordCheck } from "./recorder.mts";

export type SessionEntry = {
  sessionId: string;
  listCostMinor: string | null;
  /** 読み返しの検査に通ったか。無ければ通っていない */
  verified?: boolean;
  problems?: string[];
};

export type RecordStep = "skip" | "check" | "session";

/**
 * この面談で次に何をするか。
 * 済みなら飛ばす。セッションがあって記録のファイルもあるなら、新しいセッションを増やさず確かめ直す。それ以外はセッションを回す。
 */
export function nextRecordStep(entry: SessionEntry | undefined, fileExists: boolean): RecordStep {
  if (entry?.verified === true) return "skip";
  if (entry && fileExists) return "check";
  return "session";
}

export const hasIndexLine = (index: string, line: string): boolean => index.split("\n").includes(line);

/** 読み返しの結果から、まだ済みにできない理由を並べる。空なら済み */
export function storedProblems(stored: StoredRecordCheck, indexHasLine: boolean): string[] {
  const out: string[] = [];
  if (!stored.found) out.push("記録のファイルが無い");
  else if (!stored.identical) out.push(`渡した文と違う（${stored.firstDiff?.line} 行目）`);
  if (stored.check && stored.check.traitHits.length > 0) out.push(`性質の言葉が ${stored.check.traitHits.length} 件`);
  if (stored.check && stored.check.nameHits.length > 0) out.push(`名前が ${stored.check.nameHits.length} 件`);
  if (!indexHasLine) out.push("索引に行が無い");
  return out;
}

/** 索引の全体が、見出しと渡した行だけかを確かめる。合わない理由を並べる。空なら合っている */
export function indexProblems(index: string, heading: string, expectedLines: string[]): string[] {
  const lines = index.trimEnd().split("\n").filter((l) => l.trim() !== "");
  const expected = [heading, ...expectedLines];
  if (JSON.stringify(lines) === JSON.stringify(expected)) return [];
  const missing = expected.filter((l) => !lines.includes(l));
  const extra = lines.filter((l) => !expected.includes(l));
  const out: string[] = [];
  if (missing.length > 0) out.push(`足りない行が ${missing.length} 行`);
  if (extra.length > 0) out.push(`余分な行が ${extra.length} 行`);
  if (out.length === 0) out.push("行の順番が違う");
  return out;
}

/** 夢を始められない理由を並べる。空なら始めてよい */
export function dreamBlockers(interviewIds: string[], sessions: Record<string, SessionEntry> | undefined, indexVerified: boolean): string[] {
  const out: string[] = [];
  for (const id of interviewIds) {
    const entry = sessions?.[id];
    if (!entry) out.push(`${id}：セッションが無い`);
    else if (entry.verified !== true) out.push(`${id}：保存の検査に通っていない（${(entry.problems ?? ["検査の記録が無い"]).join("、")}）`);
  }
  if (!indexVerified) out.push("索引：合っていると確かめていない");
  return out;
}

/**
 * 夢に渡すセッションを選ぶ。本人が直した記録のセッションは外す（直す前の本文が残っているため）。
 * API は sessions を 1 本以上求めるので、全部を外すことになれば止める。
 */
export function sessionIdsForDream(interviewIds: string[], sessions: Record<string, SessionEntry>, correctedIds: string[]): { sessionIds: string[]; excluded: string[] } {
  const excluded = interviewIds.filter((id) => correctedIds.includes(id));
  const kept = interviewIds.filter((id) => !correctedIds.includes(id));
  if (kept.length === 0) throw new Error("本人が直していない面談のセッションが 1 本も無いので、夢に渡せません（直す前の本文を渡さないため）");
  return { sessionIds: kept.map((id) => sessions[id].sessionId), excluded };
}

export type SavedCorrection = { interviewId: string; oldText: string; newText: string };

export type CorrectionKept = SavedCorrection & {
  /** 夢の出力の記録に、直した後の文が残っているか */
  newTextInRecord: boolean;
  /** 夢の出力の記録に、直す前の文が戻っているか */
  oldTextInRecord: boolean;
  /** 夢が書いたファイルのうち、直す前の文を（発話の本文の行の外で）書いたもの */
  oldTextElsewhere: string[];
  kept: boolean;
};

/** 夢の出力で、本人の訂正が守られたかを確かめる */
export function checkCorrectionKept(outputFiles: StoredFile[], corrections: SavedCorrection[]): CorrectionKept[] {
  return corrections.map((c) => {
    const target = recordPath(c.interviewId);
    const record = outputFiles.find((f) => f.path === target)?.content ?? "";
    const newTextInRecord = record.includes(c.newText);
    const oldTextInRecord = record.includes(c.oldText);
    const oldTextElsewhere = outputFiles
      .filter((f) => f.path !== target)
      .filter((f) =>
        f.content
          .split("\n")
          .filter((l) => !/^\s*>/.test(l))
          .join("\n")
          .includes(c.oldText),
      )
      .map((f) => f.path);
    return { ...c, newTextInRecord, oldTextInRecord, oldTextElsewhere, kept: newTextInRecord && !oldTextInRecord && oldTextElsewhere.length === 0 };
  });
}
