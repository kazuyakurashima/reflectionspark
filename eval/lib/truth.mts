// 正解（eval/truth/*.json）の読み取り。元は eval/正解.md。
// 出どころ（source）：「作り手」は作り手が書いた番号、「決め」は判定の後に作り手が決めたこと、
// 「案」は作り手がまだ確かめていない v0 の案。主な数字は「作り手」と「決め」だけで出す。

import fs from "node:fs";
import path from "node:path";

export type Source = "作り手" | "決め" | "案";

/** 行の指定。"101-117" の範囲、数字、その配列。null は「範囲なし」（面談全体） */
export type LineSpec = string | number | Array<string | number> | null;

export type Range = {
  lines: LineSpec;
  source: Source;
  note?: string;
  items?: number[];
  alternativeLine?: string;
};

export type ItemMark = "○" | "×" | "○×" | "判定しない";

export type ItemTruth = {
  mark: ItemMark;
  good: Range | null;
  bad: Range | null;
  note?: string;
};

export type Truth = {
  case: string;
  version: string;
  kind: "生徒" | "保護者" | "コーチング";
  title: string;
  firstMeeting: boolean;
  followUpOf?: string;
  followUp?: {
    previousAction: { text: string; source: Source };
    criterion: string | null;
    verdict: "できた" | "一部" | "まだ" | "場面がなかった";
    evidenceLines: LineSpec;
    reactionLines?: LineSpec;
    source: Source;
    note?: string;
  };
  scenes: {
    strengthBest: Range;
    strengthNext: Range | null;
    issueBest: Range;
    issueNext: Range | null;
    confidence?: string;
  };
  items: Record<"1" | "2" | "3" | "4" | "5", ItemTruth>;
  climax?: { watch: "strengthBest" | "issueBest"; note: string };
  goodQuestion?: { text: string; source: Source };
  goodActions?: { by: string; text: string; source: Source }[];
  ethicsCheck?: { expected: string; source: Source; note?: string };
  typeWordCheck?: { line: number; word: string; source: Source; note?: string };
};

/** 行の指定を行番号の配列にする。null（範囲なし）は null のまま。 */
export function expandLines(spec: LineSpec): number[] | null {
  if (spec === null) return null;
  const items = Array.isArray(spec) ? spec : [spec];
  const out: number[] = [];
  for (const it of items) {
    if (typeof it === "number") {
      out.push(it);
      continue;
    }
    const m = /^(\d+)\s*[-〜~]\s*(\d+)$/.exec(it.trim());
    if (!m) {
      const n = Number(it);
      if (!Number.isInteger(n)) throw new Error(`行の指定が読めません：${it}`);
      out.push(n);
      continue;
    }
    const a = Number(m[1]);
    const b = Number(m[2]);
    for (let l = a; l <= b; l++) out.push(l);
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

/** 作り手が確かめた所か（「作り手」「決め」）。「案」は false。 */
export function isVerified(source: Source): boolean {
  return source !== "案";
}

export function loadTruth(caseName: string, dir = path.resolve("eval/truth")): Truth {
  const file = path.join(dir, `${caseName}.json`);
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as Truth;
  if (json.case !== caseName) throw new Error(`${file} の case が ${caseName} ではありません`);
  return json;
}

export function listTruthCases(dir = path.resolve("eval/truth")): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}
