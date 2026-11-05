// 工程 0a（区切りと話者）の速さを比べる。指定したケースで、0a を「作り方（copy＝今の作り方／label＝速い作り方）」と
// 「モデル・考える量」の掛け合わせで回し、組ごとに、かかった時間、出力のトークン数、発話の数、区切りが分からない所の数、
// 軸 11（話者が台本と合う割合。eval/lib/align の対応を使う）を、1 行 1 組の Markdown の表にする。0b・0c は回さない。
//
// 使い方（Mac。.env.local に ANTHROPIC_API_KEY）：
//   node --experimental-strip-types --no-warnings --env-file=.env.local eval/scripts/step0-speed.mts student-shinro student-shinro-2
//   省略できる指定：--modes copy,label  --models claude-opus-5-5,claude-sonnet-5-5  --efforts medium,low  --repeat 1  --dry-run
//   既定は、作り方 2 つ × モデル 2 つ（0a の既定のモデルと claude-sonnet-5-5）× 考える量 2 つ（medium・low）。
//   --dry-run は API を呼ばず、文の切り方と組の数、保存済みの参考の行だけを出す。
// 出力：eval/results/step0-speed/<時刻>.md（表）と <時刻>/<ケース>--<作り方>--<モデル>--<考える量>[--run2].json（発話の並びとモデルの返事）
// 参考として、eval/results/runs/<ケース>/step0.json（11/4 朝の保存結果。copy）の 0a の時間と軸 11 も表に添える。
// 組は一つずつ順に回す（同時に回すと時間が混ざる）。失敗した組は理由を表に残して先へ進む。

import fs from "node:fs";
import path from "node:path";

import { STEP0_MODEL, parseEffort } from "../../engine/claude.mts";
import type { Effort } from "../../engine/claude.mts";
import { CHECK_UNANCHORED, parseStep0aMode, runStep0a, splitSentences } from "../../engine/step0.mts";
import type { Step0Timing, Step0aOutcome } from "../../engine/step0.mts";
import type { Step0aMode, Transcript, Utterance } from "../../engine/types.mts";
import { axis11 } from "../lib/axes.mts";
import type { Axis11 } from "../lib/axes.mts";
import { RUNS_DIR, loadCase, loadJson, saveJson, stamp } from "../lib/cases.mts";
import type { EvalCase } from "../lib/cases.mts";
import { EVAL_SCRIPT_VERSION } from "../lib/version.mts";

const args = process.argv.slice(2);
const flag = (name: string): string | null => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? null) : null);
const list = (name: string, fallback: string[]): string[] => (flag(name) ? (flag(name) as string).split(",").map((s) => s.trim()).filter(Boolean) : fallback);
const dryRun = args.includes("--dry-run");
const cases = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--dry-run"));
const modes = list("--modes", ["copy", "label"]).map((m) => parseStep0aMode(m, "--modes") as Step0aMode);
const models = list("--models", [...new Set([STEP0_MODEL, "claude-sonnet-5-5"])]);
const efforts = list("--efforts", ["medium", "low"]).map((e) => parseEffort(e, "--efforts") as Effort);
const repeat = Math.max(1, Number(flag("--repeat") ?? "1") || 1);
if (cases.length === 0) {
  console.error("ケース名を 1 つ以上指定してください（例：student-shinro student-shinro-2）");
  process.exit(1);
}

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const OUT_DIR = path.resolve("eval/results/step0-speed");

type Row = {
  case: string;
  mode: Step0aMode;
  model: string;
  effort: string;
  run: number;
  /** 参考（保存済みの結果）か */
  reference: boolean;
  ms: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  sentences: number | null;
  utterances: number | null;
  unanchored: number | null;
  lowOrMid: number | null;
  axis11: Axis11 | null;
  error: string | null;
};

function countUnanchored(utterances: Utterance[]): number {
  return utterances.filter((u) => u.check.some((c) => c.startsWith(CHECK_UNANCHORED))).length;
}

function transcriptOf(c: EvalCase, utterances: Utterance[], multipleOthers: boolean, mode: Step0aMode): Transcript {
  return { kind: c.kind, raw: c.raw, utterances, multipleOthers, step0b: { proposed: [], applied: [], discarded: [] }, step0c: null, step0aMode: mode };
}

/** 11/4 朝の保存結果（copy）を参考の行にする。無ければ null */
function referenceRow(c: EvalCase): Row | null {
  const f = path.join(RUNS_DIR, c.name, "step0.json");
  const saved = loadJson<{ transcript: Transcript; timing: Step0Timing; unanchored: number }>(f);
  if (!saved) return null;
  const t = saved.transcript;
  return {
    case: c.name,
    mode: t.step0aMode ?? "copy",
    model: saved.timing.step0a.model,
    effort: "medium",
    run: 0,
    reference: true,
    ms: saved.timing.step0a.ms,
    inputTokens: saved.timing.step0a.inputTokens,
    outputTokens: saved.timing.step0a.outputTokens,
    sentences: null,
    utterances: t.utterances.length,
    unanchored: countUnanchored(t.utterances),
    lowOrMid: t.utterances.filter((u) => u.confidence !== "高").length,
    axis11: axis11(t, c.alignment, c.script),
    error: null,
  };
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${Math.round(v * 1000) / 10}%`);
const sec = (ms: number | null) => (ms === null ? "-" : (ms / 1000).toFixed(1));
const num = (v: number | null) => (v === null ? "-" : String(v));

function table(rows: Row[]): string {
  const head = "| ケース | 作り方 | モデル | 考える量 | 回 | 時間（秒） | 出力トークン | 入力トークン | 文 | 発話 | 区切りが分からない所 | 低・中 | 軸 11 正しさ | 正しい／対応 | 2 話者にまたがる | 相手 2 人以上 | 備考 |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map((r) => {
    const a = r.axis11;
    const note = r.error ? `失敗：${r.error.replace(/\|/g, "／").replace(/\n/g, " ").slice(0, 120)}` : r.reference ? "参考（保存済み。11/4 朝）" : "";
    return `| ${r.case} | ${r.mode} | ${r.model} | ${r.effort} | ${r.reference ? "-" : r.run} | ${sec(r.ms)} | ${num(r.outputTokens)} | ${num(r.inputTokens)} | ${num(r.sentences)} | ${num(r.utterances)} | ${num(r.unanchored)} | ${num(r.lowOrMid)} | ${pct(a?.accuracy)} | ${a ? `${a.correct}／${a.aligned}` : "-"} | ${a ? a.spanningSpeakers : "-"} | ${a ? (a.multipleOthers ? "あり" : "なし") : "-"} | ${note} |`;
  });
  return [head, sep, ...lines].join("\n");
}

const loaded = cases.map((name) => loadCase(name));
const combos: { mode: Step0aMode; model: string; effort: Effort }[] = [];
for (const mode of modes) for (const model of models) for (const effort of efforts) combos.push({ mode, model, effort });

log(`ケース ${loaded.map((c) => c.name).join("、")}。組 ${combos.length}（作り方 ${modes.join("・")} × モデル ${models.join("・")} × 考える量 ${efforts.join("・")}）× ${repeat} 回`);
for (const c of loaded) {
  const s = splitSentences(c.raw);
  const lens = s.map((x) => [...x.text].length);
  log(`${c.name}（${c.kind}、${[...c.raw].length} 字、台本 ${c.script.length} 行）：label では文 ${s.length}（最長 ${Math.max(...lens)} 字、平均 ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1)} 字）`);
}
const references = loaded.map(referenceRow).filter((r): r is Row => r !== null);
if (dryRun) {
  console.log(`\ndry-run：API は呼ばない。参考の行（保存済み）：\n\n${table(references)}\n`);
  process.exit(0);
}

const id = stamp();
const runDirOut = path.join(OUT_DIR, id);
fs.mkdirSync(runDirOut, { recursive: true });
const rows: Row[] = [];
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");
const writeMd = () => {
  const md = `# 工程 0a の速さの比べ（${id}、評価スクリプト ${EVAL_SCRIPT_VERSION}）

0a だけを回した（0b・0c は回さない）。時間は呼び出しの往復（adaptive thinking と streaming を含む）。出力トークンは thinking を含む。
軸 11 は、発話が台本の行に対応したものを分母に、話者が台本と合った割合。「区切りが分からない所」は、モデルの区切りを元の文に当て直せず、本人が画面 1 で分ける発話の数。
作り方：copy＝モデルに本文を写させ、元の文に当て直す（今の作り方）。label＝アプリが文に切って番号を付け、モデルは番号ごとの話者だけを返す（速い作り方）。

${table([...references, ...rows])}

- 1 組ずつ順に回した。同じ組を複数回回したときの揺れは「回」で見る。
- 発話の並びとモデルの返事：\`eval/results/step0-speed/${id}/\`
`;
  fs.writeFileSync(path.join(OUT_DIR, `${id}.md`), md);
  return md;
};

for (const c of loaded) {
  for (const combo of combos) {
    for (let run = 1; run <= repeat; run++) {
      const tag = `${c.name}--${combo.mode}--${safe(combo.model)}--${combo.effort}${run > 1 ? `--run${run}` : ""}`;
      const t0 = Date.now();
      let outcome: Step0aOutcome | null = null;
      let error: string | null = null;
      try {
        outcome = await runStep0a(c.raw, c.kind, combo);
      } catch (e) {
        error = (e as Error).message;
      }
      const ms = Date.now() - t0;
      if (outcome) {
        const t = transcriptOf(c, outcome.utterances, outcome.multipleOthers, outcome.mode);
        const a = axis11(t, c.alignment, c.script);
        rows.push({
          case: c.name,
          mode: combo.mode,
          model: combo.model,
          effort: combo.effort,
          run,
          reference: false,
          ms,
          inputTokens: outcome.meta.inputTokens,
          outputTokens: outcome.meta.outputTokens,
          sentences: outcome.sentences,
          utterances: outcome.utterances.length,
          unanchored: countUnanchored(outcome.utterances),
          lowOrMid: outcome.utterances.filter((u) => u.confidence !== "高").length,
          axis11: a,
          error: null,
        });
        saveJson(path.join(runDirOut, `${tag}.json`), { case: c.name, ...combo, run, ms, meta: outcome.meta, sentences: outcome.sentences, unanchored: outcome.unanchored, axis11: a, transcript: t, modelOutput: outcome.modelOutput });
        log(`${tag}：${sec(ms)} 秒、出力 ${outcome.meta.outputTokens} トークン、発話 ${outcome.utterances.length}、区切りが分からない所 ${countUnanchored(outcome.utterances)}、軸 11 ${pct(a.accuracy)}（${a.correct}／${a.aligned}）、2 話者にまたがる ${a.spanningSpeakers}`);
      } else {
        rows.push({ case: c.name, mode: combo.mode, model: combo.model, effort: combo.effort, run, reference: false, ms, inputTokens: null, outputTokens: null, sentences: null, utterances: null, unanchored: null, lowOrMid: null, axis11: null, error });
        saveJson(path.join(runDirOut, `${tag}.json`), { case: c.name, ...combo, run, ms, error });
        log(`${tag}：失敗（${sec(ms)} 秒）：${error}`);
      }
      writeMd();
    }
  }
}
console.log(`\n${writeMd()}`);
log(`終わり。表：eval/results/step0-speed/${id}.md`);
