// 山場の 2 本で、画面なしで端から端まで一度通し、工程ごとの時間と最初の引用が出るまでの時間を測る。
// student-shinro：工程 0 → 1 → 2 → 3（行動の候補）→ 候補の 1 番目を選んだことにする
// student-shinro-2：工程 0 → 4（次の面談での追跡）
// この通しは流れと時間を確かめるためのもので、追跡の正しさは測らない。
//
// 仮に置くもの：画面 3 の本人の答えは、eval/正解.md の student-shinro「よい行動の例」の作り手の一言を、
// 行動につながる問い（ここでは「次に試せる所」の問い）への答えとして 1 つだけ入れる（ほかの問いは空）。
// 本人の自己評価は工程 4 に渡さない（決まり 10）。
//
// 使い方：node eval/scripts/e2e.mts [--dry-run]
// 出力：eval/results/e2e/<時刻>.json と .md

import fs from "node:fs";
import path from "node:path";

import { neighborsOf } from "../../engine/citations.mts";
import { runStep0 } from "../../engine/step0.mts";
import { runStep1 } from "../../engine/step1.mts";
import { runStep2 } from "../../engine/step2.mts";
import { runStep3 } from "../../engine/step3.mts";
import { runStep4 } from "../../engine/step4.mts";
import type { Spark } from "../../engine/types.mts";
import { loadCase, saveJson, stamp } from "../lib/cases.mts";

const dryRun = process.argv.includes("--dry-run");
const first = loadCase("student-shinro");
const second = loadCase("student-shinro-2");
const answer = first.truth?.goodActions?.find((a) => a.by === "作り手の一言")?.text ?? "";
if (!answer) throw new Error("student-shinro の正解に「作り手の一言」が無い");

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const timings: { step: string; ms: number; note?: string }[] = [];
const time = async <T,>(step: string, f: () => Promise<T>, note?: (r: T) => string): Promise<T> => {
  const t0 = Date.now();
  const r = await f();
  const ms = Date.now() - t0;
  timings.push({ step, ms, note: note?.(r) });
  log(`${step}：${ms} ms${note ? `（${note(r)}）` : ""}`);
  return r;
};

if (dryRun) {
  console.log(`dry-run：student-shinro ${[...first.raw].length} 字、student-shinro-2 ${[...second.raw].length} 字`);
  console.log(`画面 3 の答え（次に試せる所の問いに）：${answer}`);
  process.exit(0);
}

const outDir = path.resolve("eval/results/e2e");
fs.mkdirSync(outDir, { recursive: true });
const id = stamp();
const result: Record<string, unknown> = { id, answer };
const flush = () => saveJson(path.join(outDir, `${id}.json`), { ...result, timings });

try {
  const total0 = Date.now();
  // 1 回目の面談
  const s0 = await time("工程 0（student-shinro）", () => runStep0(first.raw, first.kind, { with0c: true, log }), (r) => `発話 ${r.transcript.utterances.length}、直し ${r.transcript.step0b.applied.length}、推測 ${r.transcript.step0c?.guesses.length ?? 0}`);
  result.step0 = { timing: s0.timing, utterances: s0.transcript.utterances.length };
  flush();
  const s1 = await time("工程 1（student-shinro）", () => runStep1(s0.transcript), (r) => `最初の引用まで ${r.firstCitationMs ?? "-"} ms、場面 ${r.scenes.length}、引用 生成 ${r.quoteStats.generated}・捨てた ${r.quoteStats.discarded}`);
  result.step1 = s1;
  flush();
  const s2 = await time("工程 2（student-shinro）", () => runStep2(s0.transcript, s1.scenes), (r) => r.items.map((i) => `${i.item}:${i.score ?? "判定しない"}`).join(" "));
  result.step2 = s2;
  flush();
  const nextScene = s1.scenes.find((s) => s.type === "次に試せる所");
  if (!nextScene) throw new Error("次に試せる所が無いので工程 3 に進めません");
  // 画面 3：本人の答え（次に試せる所の問いにだけ入れる。ほかは空）
  const s3 = await time("工程 3（student-shinro）", () => runStep3(s0.transcript, nextScene, answer), (r) => `候補 ${r.candidates.length}、落とした ${r.dropped.length}`);
  result.step3 = s3;
  flush();
  const chosen = s3.candidates[0];
  if (!chosen) throw new Error("候補が無いので画面 4 で選べません");
  const firstMs = Date.now() - total0;
  log(`1 回目の面談の流れ全体（本人の入力の時間を除く）：${firstMs} ms`);

  // 2 回目の面談
  const spark: Spark = {
    sentence: chosen.sentence,
    criterion: chosen.criterion,
    previousScene: {
      context: nextScene.context,
      quoteText: nextScene.quotes[0]?.text ?? null,
      reading: nextScene.reading,
    },
  };
  const total1 = Date.now();
  const t0 = await time("工程 0（student-shinro-2）", () => runStep0(second.raw, second.kind, { with0c: true, log }), (r) => `発話 ${r.transcript.utterances.length}`);
  result.step0_2 = { timing: t0.timing, utterances: t0.transcript.utterances.length };
  flush();
  const s4 = await time("工程 4（student-shinro-2）", () => runStep4(t0.transcript, spark), (r) => `判定 ${r.verdict}、最初の引用まで ${r.firstCitationMs ?? "-"} ms、引用 ${r.quotes.length}`);
  result.step4 = s4;
  result.spark = spark;
  const secondMs = Date.now() - total1;
  log(`2 回目の面談の流れ全体：${secondMs} ms`);
  result.flowMs = { first: firstMs, second: secondMs };
  result.transcripts = { first: s0.transcript, second: t0.transcript };
  flush();

  const md = `# 山場の 2 本の通し（${id}）

流れと時間を確かめるためのもの。追跡の正しさは測らない。

| 工程 | 時間（ms） | 備考 |
|---|---|---|
${timings.map((t) => `| ${t.step} | ${t.ms} | ${t.note ?? ""} |`).join("\n")}
| 1 回目の流れ全体（本人の入力の時間を除く） | ${firstMs} | |
| 2 回目の流れ全体 | ${secondMs} | |

- 最初の引用が出るまで：工程 1 ${s1.firstCitationMs ?? "-"} ms、工程 4 ${s4.firstCitationMs ?? "-"} ms
- 画面 3 の答え（次に試せる所の問いに 1 つだけ）：${answer}
- 画面 4 で選んだことにした候補：${chosen.sentence}
- 工程 4 の判定：${s4.verdict}（${s4.why}）
`;
  fs.writeFileSync(path.join(outDir, `${id}.md`), md);
  console.log(md);
} catch (e) {
  result.error = (e as Error).message;
  flush();
  console.error(`止まりました：${(e as Error).message}`);
  process.exit(1);
}

// 前後の発話はアプリが発話番号から取る（neighborsOf）。ここでは使い方の確認だけ
void neighborsOf;
