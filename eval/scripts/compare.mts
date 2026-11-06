// 同じ正解・同じ評価スクリプトで計算した 2 つの結果（axes.json）を、ケースごとに「前 → 後」で並べる。LLM は呼ばない。
// 使い方：node eval/scripts/compare.mts --before <前の axes の場所> --after <後の axes の場所> --cases a,b --out <書くファイル>
// 版をまたいで比べない（CLAUDE.md「評価」）。

import fs from "node:fs";
import path from "node:path";

import { loadJson } from "../lib/cases.mts";
import { EVAL_SCRIPT_VERSION, TRUTH_VERSION } from "../lib/version.mts";

const argOf = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const beforeDir = path.resolve(argOf("--before") ?? "");
const afterDir = path.resolve(argOf("--after") ?? "");
const cases = (argOf("--cases") ?? "").split(",").filter(Boolean);
const outFile = argOf("--out");

type Scored = { scene: string; score: number }[] | null;
type SceneRow = { truthName: string; matched: boolean | null; verified: boolean; absent: boolean };
// report.mts が書く axes.json のうち、ここで読む所だけ
type Axes = {
  axis1: { displayed: number; displayedVerified: number; discarded: number; scenesWithoutQuote: number; contextWithJudgement: unknown[] } | null;
  axis2: { scenes: SceneRow[]; climax: { matched: boolean | null } | null } | null;
  axis3: Scored;
  axis5: { withheld: unknown[]; hits: unknown[]; unverifiedQuotes: number } | null;
  axis6: { aiVerdict: string; truthVerdict: string; matched: boolean; evidenceOverlaps: boolean } | null;
  axis8: { item5Withheld: boolean | null } | null;
  axis9: { satisfied: number; countable: number } | null;
  axis10: Scored;
  axis11: { utterances: number; correct: number; aligned: number; accuracy: number | null } | null;
  axis12: { overfixedOriginalCorrect: number; overfixedWrongWord: number; picked: number; mismatchSpots: number; guessStats: { total: number; reallyBroken: number } } | null;
  guessMeaning: { score: number }[] | null;
  timing: { step1Ms: number | null; firstCitationMs: number | null; step2Ms: number | null } | null;
};

const load = (dir: string, name: string) => loadJson<Axes>(path.join(dir, name, "axes.json"));
const pair = (a: unknown, b: unknown) => `${a ?? "—"} → ${b ?? "—"}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? null : `${Math.round(n * 100)}%`);
const yn = (b: boolean | null | undefined) => (b === null || b === undefined ? null : b ? "○" : "×");
const score = (xs: Scored | undefined, scene: string) => xs?.find((x) => x.scene === scene)?.score ?? null;
const scene = (a: Axes | null, name: string) => {
  const s = a?.axis2?.scenes.find((x) => x.truthName === name);
  if (!s) return null;
  if (!s.verified) return "〔案〕";
  if (s.absent) return "入力に無い";
  return yn(s.matched);
};
const avg = (xs: { score: number }[] | null | undefined) => (xs && xs.length ? (xs.reduce((s, x) => s + x.score, 0) / xs.length).toFixed(1) : null);

const rows = cases.map((name) => ({ name, b: load(beforeDir, name), a: load(afterDir, name) }));
const lines: string[] = [`# 前と後（正解 ${TRUTH_VERSION}・評価スクリプト ${EVAL_SCRIPT_VERSION}）`, "", "どのセルも「前 → 後」。", ""];

lines.push("## 正解を使わない軸", "", "| ケース | 表示した引用 | 原文と一致 | 引用を出せなかった場面 | 性質の言葉（控えた＋すり抜け） | 話者の正しさ | 直しすぎ（元が正しい／言葉が違う） |", "|---|---|---|---|---|---|---|");
for (const { name, b, a } of rows) {
  const over = (x: Axes | null) => (x?.axis12 ? `${x.axis12.overfixedOriginalCorrect}／${x.axis12.overfixedWrongWord}` : null);
  const trait = (x: Axes | null) => (x?.axis5 ? x.axis5.withheld.length + x.axis5.hits.length : null);
  lines.push(`| ${name} | ${pair(b?.axis1?.displayed, a?.axis1?.displayed)} | ${pair(b?.axis1?.displayedVerified, a?.axis1?.displayedVerified)} | ${pair(b?.axis1?.scenesWithoutQuote, a?.axis1?.scenesWithoutQuote)} | ${pair(trait(b), trait(a))} | ${pair(pct(b?.axis11?.accuracy), pct(a?.axis11?.accuracy))} | ${pair(over(b), over(a))} |`);
}

lines.push("", "## LLM 判定（1〜5）", "", "| ケース | 問い・よく表れた所 | 問い・次に試せる所 | 引用が読みを支える・よく表れた所 | 引用が読みを支える・次に試せる所 | 推測の意味（平均） |", "|---|---|---|---|---|---|");
for (const { name, b, a } of rows) {
  lines.push(`| ${name} | ${pair(score(b?.axis3, "よく表れた所"), score(a?.axis3, "よく表れた所"))} | ${pair(score(b?.axis3, "次に試せる所"), score(a?.axis3, "次に試せる所"))} | ${pair(score(b?.axis10, "よく表れた所"), score(a?.axis10, "よく表れた所"))} | ${pair(score(b?.axis10, "次に試せる所"), score(a?.axis10, "次に試せる所"))} | ${pair(avg(b?.guessMeaning), avg(a?.guessMeaning))} |`);
}

lines.push("", "## 正解を使う軸", "", "| ケース | 強み・いちばん | 強み・次点 | 課題・いちばん | 課題・次点 | 山場（記録だけ） | 項目 5 の保留 | 点の向き（満たした／数えた） |", "|---|---|---|---|---|---|---|---|");
for (const { name, b, a } of rows) {
  const dir = (x: Axes | null) => (x?.axis9 ? `${x.axis9.satisfied}／${x.axis9.countable}` : null);
  const cell = (n: string) => pair(scene(b, n), scene(a, n));
  lines.push(`| ${name} | ${cell("強み・いちばん")} | ${cell("強み・次点")} | ${cell("課題・いちばん")} | ${cell("課題・次点")} | ${pair(yn(b?.axis2?.climax?.matched), yn(a?.axis2?.climax?.matched))} | ${pair(yn(b?.axis8?.item5Withheld), yn(a?.axis8?.item5Withheld))} | ${pair(dir(b), dir(a))} |`);
}

lines.push("", "## 次回の追跡", "", "| ケース | 正解 | AI の判定 | 根拠の行が重なる |", "|---|---|---|---|");
for (const { name, b, a } of rows) {
  if (b?.axis6 || a?.axis6) lines.push(`| ${name} | ${a?.axis6?.truthVerdict ?? b?.axis6?.truthVerdict} | ${pair(b?.axis6?.aiVerdict, a?.axis6?.aiVerdict)} | ${pair(yn(b?.axis6?.evidenceOverlaps), yn(a?.axis6?.evidenceOverlaps))} |`);
}

lines.push("", "## 時間（ms）", "", "| ケース | 工程 1 | 最初の引用まで | 工程 2 |", "|---|---|---|---|");
for (const { name, b, a } of rows) {
  lines.push(`| ${name} | ${pair(b?.timing?.step1Ms, a?.timing?.step1Ms)} | ${pair(b?.timing?.firstCitationMs, a?.timing?.firstCitationMs)} | ${pair(b?.timing?.step2Ms, a?.timing?.step2Ms)} |`);
}
lines.push("");

const text = lines.join("\n");
if (outFile) {
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, text);
}
console.log(text);
