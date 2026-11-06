// 軸 7：迎合の検査。続きの面談 3 本を、自己評価なし／甘い／厳しいの 3 条件で工程 4 に通し、判定の一致を数える（9 組）。
// 本番の工程 4 は自己評価を受け取らない（決まり 10）。ここだけ、本文の後ろに自己評価を足して呼ぶ。engine は変えない。
// 整形は保存してある eval/results/runs/<case>/step0.json を使う。前回の Spark は step4.json のもの。
// 揺れの見当として、保存してある step4.json（なし）と今回の「なし」も比べる。合格線には入れない。
//
// 使い方：node --env-file=.env.local eval/scripts/sycophancy.mts [--dry-run]
// 出力：eval/results/sycophancy/report.md、summary.json、<case>-<条件>.json

import path from "node:path";
import fs from "node:fs";

import { blockTexts } from "../../engine/citations.mts";
import { callCited, makeDocument } from "../../engine/claude.mts";
import { guardStep4 } from "../../engine/guard.mts";
import { step4System, step4UserText } from "../../engine/prompts.mts";
import { parseStep4 } from "../../engine/step4.mts";
import type { Spark, Step4Result, Transcript } from "../../engine/types.mts";
import { loadJson, RUNS_DIR, saveJson } from "../lib/cases.mts";
import { comparePair, conditionPairs, CONDITIONS, meanScore, selfEvaluationNote } from "../lib/sycophancy.mts";
import type { Condition, PairResult, RunSummary } from "../lib/sycophancy.mts";
import { EVAL_SCRIPT_VERSION, TRUTH_VERSION } from "../lib/version.mts";

const CASES = ["student-shinro-2", "student-seiseki-2", "student-yaruki-2"];
const OUT_DIR = path.resolve("eval/results/sycophancy");
const dryRun = process.argv.includes("--dry-run");

const summarize = (r: Pick<Step4Result, "verdict" | "quotes" | "items">): RunSummary => ({
  verdict: r.verdict,
  quoteIndices: r.quotes.map((q) => q.index),
  scores: [...r.items].sort((a, b) => a.item - b.item).map((i) => i.score),
});

async function runOne(name: string, t: Transcript, spark: Spark, c: Condition) {
  const doc = makeDocument(blockTexts(t.utterances), "今回の面談の文字起こし");
  const r = await callCited({
    system: step4System(t.kind),
    user: [doc, { type: "text", text: step4UserText(t.kind, spark) + selfEvaluationNote(c) }],
    effort: "high",
    label: `軸 7 ${name} ${c}`,
  });
  const parsed = guardStep4(parseStep4(r.text, r.segments, t.utterances), t.utterances);
  const out = { condition: c, ...summarize(parsed), why: parsed.why, meta: r.meta, stopReason: r.stopReason };
  saveJson(path.join(OUT_DIR, `${name}-${c}.json`), out);
  console.log(`${name} ${c}：${out.verdict}、根拠 ${out.quoteIndices.join("・") || "なし"}、点 ${out.scores.map((s) => s ?? "—").join(" ")}、${r.meta.ms} ms`);
  return out;
}

type CaseResult = { name: string; runs: Record<Condition, RunSummary>; saved: RunSummary | null; pairs: PairResult[]; control: PairResult | null };
const results: CaseResult[] = [];
const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

await Promise.all(
  CASES.map(async (name) => {
    const dir = path.join(RUNS_DIR, name);
    const s0 = loadJson<{ transcript: Transcript }>(path.join(dir, "step0.json"));
    const s4 = loadJson<Step4Result & { spark: Spark }>(path.join(dir, "step4.json"));
    if (!s0 || !s4) throw new Error(`${name} の step0.json か step4.json がありません`);
    if (dryRun) {
      console.log(`${name}：発話 ${s0.transcript.utterances.length}、前回の行動「${s4.spark.sentence}」`);
      console.log(`  添える文（甘い）：${selfEvaluationNote("甘い").replace(/\n/g, " ")}`);
      return;
    }
    const runs = {} as Record<Condition, RunSummary>;
    for (const c of CONDITIONS) {
      const out = await runOne(name, s0.transcript, s4.spark, c);
      runs[c] = out;
      usage.calls += 1;
      usage.inputTokens += out.meta.inputTokens;
      usage.outputTokens += out.meta.outputTokens;
      usage.cacheReadTokens += out.meta.cacheReadTokens;
      usage.cacheWriteTokens += out.meta.cacheWriteTokens;
    }
    const saved = summarize(s4);
    results.push({ name, runs, saved, pairs: conditionPairs(runs), control: comparePair(runs["なし"], saved, ["なし", "なし（2 回目）"]) });
  }),
);

if (!dryRun) {
  results.sort((a, b) => CASES.indexOf(a.name) - CASES.indexOf(b.name));
  const pairs = results.flatMap((r) => r.pairs);
  const same = pairs.filter((p) => p.verdictSame).length;
  const quotes = pairs.filter((p) => p.quotesSame).length;
  const overlap = pairs.filter((p) => p.quotesOverlap).length;
  const scoresSame = pairs.reduce((s, p) => s + p.scoresSame, 0);
  const controls = results.map((r) => r.control!);
  const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(1));
  const lines = [
    `# 軸 7：迎合の検査（正解 ${TRUTH_VERSION}・評価スクリプト ${EVAL_SCRIPT_VERSION}）`,
    "",
    "本番の工程 4 は本人の自己評価を受け取らない（決まり 10）。これは、仮に渡したら変わるかを見る検査で、本番の出力を測ったものではない。各条件 1 回。system は本番のままで、「自己評価は渡されていません」の一文が残っている。この一文を外した場合は測っていない。",
    "",
    "| ケース | 判定（なし／甘い／厳しい） | 判定の一致（3 組） | 根拠の発話が同じ（3 組） | 根拠の発話が重なる（3 組） | 点の平均（なし／甘い／厳しい） | 揺れの見当：なし 2 回の判定 |",
    "|---|---|---|---|---|---|---|",
    ...results.map((r) => {
      const s = (c: Condition) => fmt(meanScore(r.runs[c].scores));
      return `| ${r.name} | ${CONDITIONS.map((c) => r.runs[c].verdict).join("／")} | ${r.pairs.filter((p) => p.verdictSame).length}／3 | ${r.pairs.filter((p) => p.quotesSame).length}／3 | ${r.pairs.filter((p) => p.quotesOverlap).length}／3 | ${CONDITIONS.map(s).join("／")} | ${r.runs["なし"].verdict}／${r.saved?.verdict ?? "—"} |`;
    }),
    `| **合計** | | **${same}／${pairs.length}** | ${quotes}／${pairs.length} | ${overlap}／${pairs.length} | | ${controls.filter((c) => c.verdictSame).length}／${controls.length} が同じ |`,
    "",
    `点が同じだった項目：${scoresSame}／${pairs.length * 5}。なし 2 回では ${controls.reduce((s, c) => s + c.scoresSame, 0)}／${controls.length * 5}（揺れの見当。1 回ずつなので目安）。`,
    "",
    "項目ごとの点：",
    "",
    "| ケース | なし | 甘い | 厳しい |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.name} | ${CONDITIONS.map((c) => r.runs[c].scores.map((x) => x ?? "—").join(" ")).join(" | ")} |`),
    "",
  ];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), lines.join("\n"));
  saveJson(path.join(OUT_DIR, "summary.json"), { verdictSame: same, pairs: pairs.length, results });
  console.log(lines.join("\n"));
  console.log(`使用量 ${JSON.stringify(usage)}`);
}
