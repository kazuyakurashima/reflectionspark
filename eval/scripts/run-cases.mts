// 正解のある 4 本で回す（工程 0・1・2。student-shinro-2 は工程 4 も）。4 本ともボイスメモの文字起こしから。
// 整形（工程 0）は 1 本につき 1 回だけ回し、保存して使い回す（--fresh で回し直す）。
// 整形の揺れ：--stability <case> <回数> で、工程 0 を同じ入力でさらに回し、1 回目とは別に保存する（分析には使わない）。
// 追跡（軸 6）：student-shinro-2 の工程 4 には、eval/正解.md の「前回の一手」を前回の Spark として渡す。できたかの基準は正解に無いので空。
//
// 使い方：
//   node eval/scripts/run-cases.mts                  正解のある 4 本（工程 0・1・2、shinro-2 は 4）
//   node eval/scripts/run-cases.mts --case parent    1 本だけ
//   node eval/scripts/run-cases.mts --stability student-shinro 2   工程 0 をさらに 2 回（計 3 回）
//   node eval/scripts/run-cases.mts --dry-run        API を呼ばず、入力と保存先を確かめる
// 出力：eval/results/runs/<case>/step0.json、step1.json、step2.json、step4.json、step0-run2.json …
// 軸の計算とまとめは eval/scripts/report.mts。

import path from "node:path";

import { runStep0 } from "../../engine/step0.mts";
import { runStep1 } from "../../engine/step1.mts";
import { runStep2 } from "../../engine/step2.mts";
import { runStep4 } from "../../engine/step4.mts";
import type { Step0Timing } from "../../engine/step0.mts";
import type { Spark, Transcript } from "../../engine/types.mts";
import { loadCase, loadJson, runDir, saveJson } from "../lib/cases.mts";
import { listTruthCases } from "../lib/truth.mts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fresh = args.includes("--fresh");
const caseArg = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const stabilityCase = args.includes("--stability") ? args[args.indexOf("--stability") + 1] : null;
const stabilityRuns = stabilityCase ? Number(args[args.indexOf("--stability") + 2] ?? "2") : 0;

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const cases = caseArg ? [caseArg] : stabilityCase ? [stabilityCase] : listTruthCases();

type Step0File = { transcript: Transcript; timing: Step0Timing; unanchored: number };

for (const name of cases) {
  const c = loadCase(name);
  const dir = runDir(name);
  log(`== ${name}（${c.kind}、${[...c.raw].length} 字、台本 ${c.script.length} 行、文字起こしに無い行 ${c.alignment.missingLines.length}）`);
  if (dryRun) {
    log(`保存先：${dir}。正解：${c.truth ? "あり" : "なし（回さない）"}`);
    continue;
  }
  if (!c.truth) {
    log("作り手がまだ正解を書いていないので、出力を先に作らない。飛ばす。");
    continue;
  }
  try {
    if (stabilityCase) {
      for (let i = 0; i < stabilityRuns; i++) {
        const existing = [2, 3, 4, 5, 6].map((n) => path.join(dir, `step0-run${n}.json`)).find((f) => !loadJson(f));
        if (!existing) break;
        const r = await runStep0(c.raw, c.kind, { with0c: true, log });
        saveJson(existing, r satisfies Step0File);
        log(`整形の揺れ：${path.basename(existing)} に保存`);
      }
      continue;
    }

    const step0File = path.join(dir, "step0.json");
    let s0 = fresh ? null : loadJson<Step0File>(step0File);
    if (s0) log(`工程 0：保存した結果を使う（${s0.transcript.utterances.length} 発話）`);
    else {
      s0 = await runStep0(c.raw, c.kind, { with0c: true, log });
      saveJson(step0File, s0);
      log(`工程 0：${s0.transcript.utterances.length} 発話、0a ${s0.timing.step0a.ms} ms、0b ${s0.timing.step0b?.ms ?? "-"} ms、0c ${s0.timing.step0c?.ms ?? "-"} ms`);
    }
    const t = s0.transcript;

    const s1 = await runStep1(t);
    saveJson(path.join(dir, "step1.json"), s1);
    log(`工程 1：${s1.meta.ms} ms、最初の引用まで ${s1.firstCitationMs ?? "-"} ms、場面 ${s1.scenes.length}、引用 生成 ${s1.quoteStats.generated}・捨てた ${s1.quoteStats.discarded}・出せなかった場面 ${s1.quoteStats.scenesWithoutQuote}`);

    const s2 = await runStep2(t, s1.scenes);
    saveJson(path.join(dir, "step2.json"), s2);
    log(`工程 2：${s2.meta.ms} ms、${s2.items.map((i) => `${i.item}:${i.score ?? "判定しない"}`).join(" ")}、倫理 ${s2.ethics.level}`);

    if (c.truth.followUp) {
      const spark: Spark = {
        sentence: c.truth.followUp.previousAction.text,
        criterion: c.truth.followUp.criterion, // 正解に無いので null（空で渡す）
        previousScene: null,
      };
      const s4 = await runStep4(t, spark);
      saveJson(path.join(dir, "step4.json"), { ...s4, spark });
      log(`工程 4：${s4.meta.ms} ms、判定 ${s4.verdict}、引用 ${s4.quotes.length}（捨てた ${s4.quoteStats.discarded}）`);
    }
  } catch (e) {
    console.error(`${name} で止まりました：${(e as Error).message}`);
    process.exit(1);
  }
}
log("終わり。軸の計算は node eval/scripts/report.mts");
