// 工程 4 の「なぜ」（画面 4 の AI の見立て）から発話番号を外した変更（11/8）の前と後を、続きの面談 3 本で比べる。
// 後：今のプロンプトで工程 4 を 1 本 1 回回す。前回の Spark は正解の「前回の一手」、できたかの基準は空（run-cases と同じ）。
// 前：保存してある工程 4 の出力（student-shinro-2 は eval/results/runs、ほかの 2 本は eval/results/memory/analysis）。
// 文字起こしは前と同じもの（保存してある工程 0 の結果）を使う。
//
// 使い方：
//   node --experimental-strip-types --env-file=.env.local eval/scripts/step4-why.mts --run run2   後を回して、表を書く
//   node --experimental-strip-types eval/scripts/step4-why.mts --dry-run                         API を呼ばず、前の数字だけ出す
// 出力：eval/results/1108-why/<run>/<case>/step4.json と summary.json、表は標準出力

import fs from "node:fs";
import path from "node:path";

import { runStep4 } from "../../engine/step4.mts";
import type { Spark, Step4Result, Transcript } from "../../engine/types.mts";
import { findUtteranceRefs } from "../../engine/utterance-no.mts";
import { axis5, axis6 } from "../lib/axes.mts";
import { loadCase, loadJson, saveJson } from "../lib/cases.mts";

const dryRun = process.argv.includes("--dry-run");
const run = process.argv.includes("--run") ? process.argv[process.argv.indexOf("--run") + 1] : "run1";
const OUT = path.resolve("eval/results/1108-why", run);
const CASES = ["student-shinro-2", "student-seiseki-2", "student-yaruki-2"] as const;

type Before = { step4: Step4Result; transcript: Transcript; from: string };

function before(name: string): Before {
  if (name === "student-shinro-2") {
    const s4 = loadJson<Step4Result>("eval/results/runs/student-shinro-2/step4.json");
    const s0 = loadJson<{ transcript: Transcript }>("eval/results/runs/student-shinro-2/step0.json");
    if (!s4 || !s0) throw new Error(`${name} の前の出力が無い`);
    return { step4: s4, transcript: s0.transcript, from: "eval/results/runs（11/8 朝）" };
  }
  const a = loadJson<{ step4: Step4Result; transcript: Transcript }>(`eval/results/memory/analysis/${name}.json`);
  if (!a) throw new Error(`${name} の前の出力が無い`);
  return { step4: a.step4, transcript: a.transcript, from: "eval/results/memory/analysis（11/6）" };
}

/** 画面に出す文（なぜと相手の 1 行）に残った「発話 n」の数 */
const shownRefs = (s: Step4Result) => findUtteranceRefs(s.why).length + findUtteranceRefs(s.otherPersonLine ?? "").length;

function row(name: string, s: Step4Result, t: Transcript) {
  const c = loadCase(name);
  if (!c.truth) throw new Error(`${name} に正解が無い`);
  const a6 = axis6(s, c.truth, t, c.alignment);
  const a5 = axis5(null, null, null, s);
  return {
    shownRefs: shownRefs(s),
    whyChars: [...s.why].length,
    whySentences: s.why.split("。").filter((x) => x.trim() !== "").length,
    whyRefs: s.whyRefs ?? null,
    whyKey: s.whyKey ?? null,
    otherRefs: s.otherRefs ?? null,
    verdict: s.verdict,
    truthVerdict: a6?.truthVerdict ?? null,
    matched: a6?.matched ?? null,
    evidenceOverlaps: a6?.evidenceOverlaps ?? null,
    quotes: s.quotes.length,
    discarded: s.quoteStats.discarded,
    axis5Hits: a5.hits.length,
    why: s.why,
    otherPersonLine: s.otherPersonLine,
    meta: s.meta,
  };
}

const results: Record<string, { before: ReturnType<typeof row> & { from: string }; after: ReturnType<typeof row> | null }> = {};
for (const name of CASES) {
  const b = before(name);
  results[name] = { before: { ...row(name, b.step4, b.transcript), from: b.from }, after: null };
  if (dryRun) continue;
  const c = loadCase(name);
  const spark: Spark = { sentence: c.truth!.followUp!.previousAction.text, criterion: c.truth!.followUp!.criterion, previousScene: null };
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${name}：工程 4 を回す`);
  const s4 = await runStep4(b.transcript, spark);
  saveJson(path.join(OUT, name, "step4.json"), { ...s4, spark });
  results[name].after = row(name, s4, b.transcript);
  console.log(`  ${s4.meta.ms} ms、判定 ${s4.verdict}、引用 ${s4.quotes.length}、出力 ${s4.meta.outputTokens} トークン`);
}
if (!dryRun) {
  fs.mkdirSync(OUT, { recursive: true });
  saveJson(path.join(OUT, "summary.json"), results);
}

const yn = (x: boolean | null) => (x === null ? "-" : x ? "○" : "×");
console.log("\n| ケース | 文に残った番号 | 判定（正解） | 判定が正解と合う | 根拠が正解の範囲と重なる | 引用（捨てた） | 性質の言葉 | なぜの字数・文 | 要の一句 |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const name of CASES) {
  const { before: b, after: a } = results[name];
  const pair = <T,>(f: (r: ReturnType<typeof row>) => T, fmt: (v: T) => string = String) => (a ? `${fmt(f(b))} → ${fmt(f(a))}` : fmt(f(b)));
  console.log(
    `| ${name} | ${pair((r) => r.shownRefs)} | ${pair((r) => r.verdict)}（${b.truthVerdict}） | ${pair((r) => r.matched, yn)} | ${pair((r) => r.evidenceOverlaps, yn)} | ${pair((r) => `${r.quotes}（${r.discarded}）`)} | ${pair((r) => r.axis5Hits)} | ${pair((r) => `${r.whyChars}・${r.whySentences}`)} | ${a ? (a.whyKey ? "あり" : "なし") : "-"} |`,
  );
}
for (const name of CASES) {
  const { before: b, after: a } = results[name];
  console.log(`\n### ${name}\n- 前（${b.from}）：${b.why}`);
  if (b.otherPersonLine) console.log(`  - 相手の 1 行：${b.otherPersonLine}`);
  if (a) {
    console.log(`- 後：${a.why}\n  - 指す発話：${a.whyRefs?.join("、") ?? "-"}／要の一句：${a.whyKey ?? "なし"}`);
    if (a.otherPersonLine) console.log(`  - 相手の 1 行：${a.otherPersonLine}（指す発話：${a.otherRefs?.join("、") ?? "-"}）`);
  }
}
