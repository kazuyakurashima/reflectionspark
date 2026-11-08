// 山場の 2 本で、画面なしで端から端まで一度通し、工程ごとの時間と最初の引用が出るまでの時間を測る。
// student-shinro：工程 0 → 1 → 2 → 3（行動の候補）→ 候補の 1 番目を選んだことにする
// student-shinro-2：工程 0 → 4（次の面談での追跡）
// この通しは流れと時間を確かめるためのもので、追跡の正しさは測らない。
//
// 仮に置くもの：画面 2 で問いに書く本人の答えは、eval/正解.md の student-shinro「よい行動の例」の作り手の一言を、
// 行動につながる問い（ここでは「次に試せる所」の問い）への答えとして 1 つだけ入れる（ほかの問いは空）。
// 本人の自己評価は工程 4 に渡さない（決まり 10）。
//
// 使い方：node eval/scripts/e2e.mts [--dry-run]
// 出力：eval/results/e2e/<時刻>.json と .md

import fs from "node:fs";
import path from "node:path";

import { neighborsOf } from "../../engine/citations.mts";
import { attachStep0c, runStep0, runStep0c, waitShort } from "../../engine/step0.mts";
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
  console.log(`画面 2 の問いへの答え（次に試せる所の問いに）：${answer}`);
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
  const s0 = await time("工程 0（student-shinro。0a・0b）", () => runStep0(first.raw, first.kind, { log }), (r) => `発話 ${r.transcript.utterances.length}、直し ${r.transcript.step0b.applied.length}`);
  result.step0 = { timing: s0.timing, utterances: s0.transcript.utterances.length };
  flush();
  // 0c は別に回し、分析と同時に送る。分析が終わってから短く待ち、間に合わなければ推測なしで出す
  const c0Started = Date.now();
  const c0 = runStep0c(s0.transcript).then((r) => ({ ...r, ms: Date.now() - c0Started }));
  const s1 = await time("工程 1（student-shinro）", () => runStep1(s0.transcript), (r) => `最初の引用まで ${r.firstCitationMs ?? "-"} ms、場面 ${r.scenes.length}、引用 生成 ${r.quoteStats.generated}・捨てた ${r.quoteStats.discarded}`);
  result.step1 = s1;
  flush();
  const s2 = await time("工程 2（student-shinro）", () => runStep2(s0.transcript, s1.scenes, { firstMeeting: true }), (r) => r.items.map((i) => `${i.item}:${i.score ?? "判定しない"}`).join(" "));
  result.step2 = s2;
  flush();
  const c0r = await time("工程 0c の短い待ち（student-shinro。分析の後、3 秒まで）", () => waitShort(c0, 3000), (r) => (r ? `間に合った（0c 全体 ${r.ms} ms、推測 ${r.result.guesses.length}）` : "間に合わなかった（推測なしで出す）"));
  if (c0r) s0.transcript = attachStep0c(s0.transcript, c0r.result, s0.transcript.utterances.length);
  result.step0c = c0r ? { ms: c0r.ms, guesses: c0r.result.guesses.length, inTime: true } : { inTime: false };
  flush();
  const nextScene = s1.scenes.find((s) => s.type === "次に試せる所");
  if (!nextScene) throw new Error("次に試せる所が無いので工程 3 に進めません");
  // 画面 2 の問いへの本人の答え（次に試せる所の問いにだけ入れる。ほかは空）
  const s3 = await time("工程 3（student-shinro）", () => runStep3(s0.transcript, nextScene, answer), (r) => `候補 ${r.candidates.length}、落とした ${r.dropped.length}`);
  result.step3 = s3;
  flush();
  const chosen = s3.candidates[0];
  if (!chosen) throw new Error("候補が無いので画面 3 で選べません");
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
  const t0 = await time("工程 0（student-shinro-2。0a・0b）", () => runStep0(second.raw, second.kind, { log }), (r) => `発話 ${r.transcript.utterances.length}`);
  result.step0_2 = { timing: t0.timing, utterances: t0.transcript.utterances.length };
  flush();
  const c2Started = Date.now();
  const c2 = runStep0c(t0.transcript).then((r) => ({ ...r, ms: Date.now() - c2Started }));
  const s4 = await time("工程 4（student-shinro-2）", () => runStep4(t0.transcript, spark), (r) => `判定 ${r.verdict}、最初の引用まで ${r.firstCitationMs ?? "-"} ms、引用 ${r.quotes.length}`);
  result.step4 = s4;
  result.spark = spark;
  const c2r = await time("工程 0c の短い待ち（student-shinro-2）", () => waitShort(c2, 3000), (r) => (r ? `間に合った（0c 全体 ${r.ms} ms、推測 ${r.result.guesses.length}）` : "間に合わなかった（推測なしで出す）"));
  if (c2r) t0.transcript = attachStep0c(t0.transcript, c2r.result, t0.transcript.utterances.length);
  result.step0c_2 = c2r ? { ms: c2r.ms, guesses: c2r.result.guesses.length, inTime: true } : { inTime: false };
  const secondMs = Date.now() - total1;
  log(`2 回目の面談の流れ全体：${secondMs} ms`);
  result.flowMs = { first: firstMs, second: secondMs };
  result.transcripts = { first: s0.transcript, second: t0.transcript };
  flush();
  // 間に合わなかった 0c は、流れの時間には入れずに、記録のためだけに待って保存する
  const late1 = c0r ? null : await c0;
  const late2 = c2r ? null : await c2;
  if (late1) result.step0c = { ms: late1.ms, guesses: late1.result.guesses.length, inTime: false };
  if (late2) result.step0c_2 = { ms: late2.ms, guesses: late2.result.guesses.length, inTime: false };
  flush();

  const md = `# 山場の 2 本の通し（${id}）

流れと時間を確かめるためのもの。追跡の正しさは測らない。

| 工程 | 時間（ms） | 備考 |
|---|---|---|
${timings.map((t) => `| ${t.step} | ${t.ms} | ${t.note ?? ""} |`).join("\n")}
| 1 回目の流れ全体（本人の入力の時間を除く） | ${firstMs} | |
| 2 回目の流れ全体 | ${secondMs} | |

- 最初の引用が出るまで：工程 1 ${s1.firstCitationMs ?? "-"} ms、工程 4 ${s4.firstCitationMs ?? "-"} ms
- 画面 2 の問いへの答え（次に試せる所の問いに 1 つだけ）：${answer}
- 画面 3 で選んだことにした候補：${chosen.sentence}
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
