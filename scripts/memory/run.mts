// 記録係と夢の最小の実証（検証用・暫定）。docs/設計書.md「覚えていると整理」。
// ダミーの面談 6 本（同じ講師の 3 組）を、今のエンジンで分析し、記録係に 1 回 1 ファイルで書かせ、夢を 1 回回し、
// 夢の出力の根拠を発話の原文と照合する。本番のデータ（localStorage、Demo Mode）とは混ぜない。
// どの出力も「検証用・暫定」。本人が確かめた分析として扱わない。
//
// 使い方（API キーは環境変数。値はファイルに書かない）：
//   node scripts/memory/run.mts analyze                 6 本の分析（保存した結果があれば使う。--fresh で回し直す）
//   node scripts/memory/run.mts record --state <file> --session-cap-minor <n> [--dry-run]
//   node scripts/memory/run.mts dream  --state <file> --cap <入力トークン換算の上限>
//   node scripts/memory/run.mts verify --state <file>
//   node scripts/memory/run.mts summary --state <file>   時間・トークン数・失敗とやり直しの表
// --state は、作ったリソースの ID を控えるファイル（リポジトリの外に置く。ID と金額はリポジトリに入れない）。
// 出力：eval/results/memory/analysis/<面談>.json、eval/results/memory/<実行の印>/…

import fs from "node:fs";
import path from "node:path";

import { getClient } from "../../engine/claude.mts";
import { parseEvidenceRefs, parseHypotheses, summarizeEvidence, summarizeHypotheses, verifyEvidence } from "../../engine/memory-evidence.mts";
import type { EvidenceCheck } from "../../engine/memory-evidence.mts";
import { buildFactRecord, checkMarkdown, checkRecord, indexLine, INDEX_PATH, recordPath, renderRecord } from "../../engine/memory-record.mts";
import type { FactRecord } from "../../engine/memory-record.mts";
import { checkStoredRecord, createRecorderResources, DREAM_FILES, DREAM_MODEL, dreamInstructions, INDEX_HEADING, readStore, RECORDER_MODEL, recordInterview, runDream } from "../../engine/recorder.mts";
import type { RecorderResources, SessionUsage } from "../../engine/recorder.mts";
import { runStep0 } from "../../engine/step0.mts";
import { runStep1 } from "../../engine/step1.mts";
import { runStep2 } from "../../engine/step2.mts";
import { runStep4 } from "../../engine/step4.mts";
import type { CallMeta, Spark, Step1Result, Step2Result, Step4Result, Transcript } from "../../engine/types.mts";
import { loadCase, loadJson, saveJson, stamp } from "../../eval/lib/cases.mts";

const STATUS = "検証用・暫定（ダミーの面談。本人は確かめていない）";
const OUT_DIR = path.resolve("eval/results/memory");
const ANALYSIS_DIR = path.join(OUT_DIR, "analysis");
/** 山場の 1 組は、11/5 の通しの結果（今の札つきのエンジン）から、整形と 1 回目の分析を使う */
const E2E_FILE = path.resolve("eval/results/e2e/2026-11-05T16-24-28.json");

type Plan = { id: string; order: number; other: string; follows: string | null; followedBy: string | null };
/** 同じ講師の 6 本。並びは、1 回目の 3 本のあとに続きの 3 本（日付は台本に無いので、順番だけを書く） */
const PLAN: Plan[] = [
  { id: "student-shinro", order: 1, other: "相手 A", follows: null, followedBy: "student-shinro-2" },
  { id: "student-seiseki", order: 2, other: "相手 B", follows: null, followedBy: "student-seiseki-2" },
  { id: "student-yaruki", order: 3, other: "相手 C", follows: null, followedBy: "student-yaruki-2" },
  { id: "student-shinro-2", order: 4, other: "相手 A", follows: "student-shinro", followedBy: null },
  { id: "student-yaruki-2", order: 5, other: "相手 C", follows: "student-yaruki", followedBy: null },
  { id: "student-seiseki-2", order: 6, other: "相手 B", follows: "student-seiseki", followedBy: null },
];

type Analysis = {
  id: string;
  status: string;
  /** どこから来たか（今回回した／保存した結果を使った） */
  source: { step0: string; step1: string; step2: string | null; step4: string | null };
  transcript: Transcript;
  step1: Step1Result;
  step2: Step2Result | null;
  step4: Step4Result | null;
  /** 続きの面談で、工程 4 に渡した前回の行動 */
  spark: Spark | null;
  timing: { step0: CallMeta[]; step1: CallMeta; step2: CallMeta | null; step4: CallMeta | null };
  failures: string[];
};

type State = {
  runId?: string;
  resources?: RecorderResources & { environmentName: string; agentName: string };
  sessions?: Record<string, { sessionId: string; listCostMinor: string | null }>;
  dream?: { dreamId: string; outputStoreId: string | null; sessionId: string | null; listCostMinor?: string | null };
};

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

function statePath(): string {
  const p = option("--state");
  if (!p) throw new Error("--state <file> を付けてください（作ったリソースの ID を控えるファイル。リポジトリの外に置く）");
  return path.resolve(p);
}
const loadState = (): State => loadJson<State>(statePath()) ?? {};
const saveState = (s: State) => saveJson(statePath(), s);

async function retry<T>(label: string, failures: string[], f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    failures.push(`${label}：1 回目に失敗（${(e as Error).message.slice(0, 200)}）。やり直した`);
    log(`${label}：失敗したのでやり直す（${(e as Error).message.slice(0, 120)}）`);
    return await f();
  }
}

/** 続きの面談の正解にある「前回の一手」を、1 回目の面談で本人が選んだ行動として置く */
function sparkFor(followUpCase: string): Spark {
  const t = loadCase(followUpCase).truth;
  if (!t?.followUp) throw new Error(`${followUpCase} の正解に「前回の一手」が無い`);
  return { sentence: t.followUp.previousAction.text, criterion: t.followUp.criterion, previousScene: null };
}

async function analyzeOne(p: Plan): Promise<Analysis> {
  const file = path.join(ANALYSIS_DIR, `${p.id}.json`);
  const saved = flag("--fresh") ? null : loadJson<Analysis>(file);
  if (saved) {
    log(`${p.id}：保存した分析を使う`);
    return saved;
  }
  const failures: string[] = [];
  const c = loadCase(p.id);
  const e2e = p.id.startsWith("student-shinro") ? loadJson<{ transcripts: { first: Transcript; second: Transcript }; step1: Step1Result; step2: Step2Result }>(E2E_FILE) : null;
  const e2eName = path.relative(process.cwd(), E2E_FILE);

  let transcript: Transcript;
  let step0Source: string;
  const step0Meta: CallMeta[] = [];
  if (e2e) {
    transcript = p.follows ? e2e.transcripts.second : e2e.transcripts.first;
    step0Source = `保存した結果（${e2eName}）`;
  } else {
    const r = await retry(`${p.id} 工程 0`, failures, () => runStep0(c.raw, c.kind, { log: (s) => log(`${p.id} ${s}`) }));
    transcript = r.transcript;
    step0Source = "今回";
    step0Meta.push(r.timing.step0a, ...(r.timing.step0b ? [r.timing.step0b] : []));
    log(`${p.id} 工程 0：${transcript.utterances.length} 発話、当て直せなかった所 ${r.unanchored}`);
  }

  let step1: Step1Result;
  let step1Source: string;
  let step2: Step2Result | null = null;
  let step2Source: string | null = null;
  if (e2e && !p.follows) {
    step1 = e2e.step1;
    step1Source = `保存した結果（${e2eName}）`;
    step2 = e2e.step2;
    step2Source = step1Source;
  } else {
    step1 = await retry(`${p.id} 工程 1`, failures, () => runStep1(transcript));
    step1Source = "今回";
    log(`${p.id} 工程 1：${step1.meta.ms} ms、場面 ${step1.scenes.length}、引用 生成 ${step1.quoteStats.generated}・捨てた ${step1.quoteStats.discarded}`);
    if (!p.follows) {
      const s1 = step1;
      step2 = await retry(`${p.id} 工程 2`, failures, () => runStep2(transcript, s1.scenes, { firstMeeting: true }));
      step2Source = "今回";
      log(`${p.id} 工程 2：${step2.meta.ms} ms、${step2.items.map((i) => `${i.item}:${i.score ?? "判定しない"}`).join(" ")}`);
    }
  }

  let step4: Step4Result | null = null;
  let spark: Spark | null = null;
  if (p.follows) {
    // 本人の自己評価と、前回の AI の点・判定は渡さない（決まり 10）。渡すのは前回の行動の文だけ
    const sp = sparkFor(p.id);
    spark = sp;
    step4 = await retry(`${p.id} 工程 4`, failures, () => runStep4(transcript, sp));
    log(`${p.id} 工程 4：${step4.meta.ms} ms、判定 ${step4.verdict}、引用 ${step4.quotes.length}（捨てた ${step4.quoteStats.discarded}）`);
  }

  const a: Analysis = {
    id: p.id,
    status: STATUS,
    source: { step0: step0Source, step1: step1Source, step2: step2Source, step4: step4 ? "今回" : null },
    transcript,
    step1,
    step2,
    step4,
    spark,
    timing: { step0: step0Meta, step1: step1.meta, step2: step2?.meta ?? null, step4: step4?.meta ?? null },
    failures,
  };
  saveJson(file, a);
  return a;
}

function loadAnalyses(): Analysis[] {
  return PLAN.map((p) => {
    const a = loadJson<Analysis>(path.join(ANALYSIS_DIR, `${p.id}.json`));
    if (!a) throw new Error(`${p.id} の分析がまだ無い。先に analyze を回す`);
    return a;
  });
}

/** 分析の結果から、6 本の記録を作る。渡すのは分析の結果だけ（本人の自己採点・自己評価は、ここに来ない） */
function buildRecords(analyses: Analysis[]): { plan: Plan; record: FactRecord; markdown: string; index: string }[] {
  return PLAN.map((p) => {
    const a = analyses.find((x) => x.id === p.id) as Analysis;
    const next = p.followedBy ? sparkFor(p.followedBy) : null;
    const record = buildFactRecord({
      interviewId: p.id,
      kind: a.transcript.kind,
      order: p.order,
      otherTag: p.other,
      followsInterviewId: p.follows,
      status: STATUS,
      utterances: a.transcript.utterances,
      step1: { scenes: a.step1.scenes, noScene: a.step1.noScene },
      step2: a.step2 ? { items: a.step2.items } : null,
      chosenAction: next ? { sentence: next.sentence, criterion: next.criterion, origin: "検証用に置いた（評価の正解にある「前回の一手」。本人が選んだものではない）" } : null,
      followUp:
        p.follows && a.step4 && a.spark
          ? {
              previousInterviewId: p.follows,
              previousAction: a.spark.sentence,
              criterion: a.spark.criterion,
              step4: { verdict: a.step4.verdict, quotes: a.step4.quotes, why: a.step4.why, items: a.step4.items, otherPersonLine: a.step4.otherPersonLine },
            }
          : null,
    });
    return { plan: p, record, markdown: renderRecord(record), index: indexLine(record) };
  });
}

function runDirOf(state: State): string {
  if (!state.runId) throw new Error("実行の印がまだ無い。先に record を回す");
  return path.join(OUT_DIR, state.runId);
}

const tokensOf = (u: SessionUsage) => ({ inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, activeSeconds: u.activeSeconds });

async function commandAnalyze(): Promise<void> {
  const t0 = Date.now();
  const results = await Promise.all(PLAN.map((p) => analyzeOne(p)));
  const rows = results.map((a) => {
    const metas = [...a.timing.step0, a.timing.step1, ...(a.timing.step2 ? [a.timing.step2] : []), ...(a.timing.step4 ? [a.timing.step4] : [])];
    return { id: a.id, utterances: a.transcript.utterances.length, scenes: a.step1.scenes.length, verdict: a.step4?.verdict ?? null, calls: metas.length, failures: a.failures };
  });
  console.table(rows.map((r) => ({ ...r, failures: r.failures.length })));
  log(`分析 終わり（${Date.now() - t0} ms）`);
}

async function commandRecord(): Promise<void> {
  const analyses = loadAnalyses();
  const built = buildRecords(analyses);
  const tags = [...new Set(PLAN.map((p) => p.other))];
  // 書く前の検査：性質の言葉と名前。札（相手 A など）は名前ではないので、名前の一覧には入れない
  const before = built.map((b) => ({ id: b.plan.id, check: checkRecord(b.record), dropped: b.record.dropped, chars: [...b.markdown].length }));
  console.table(before.map((b) => ({ id: b.id, 字数: b.chars, 性質の言葉: b.check.traitHits.length, 名前: b.check.nameHits.length, 合わず捨てた引用: b.dropped.unverifiedQuotes, 控えた欄: b.dropped.withheldFields.length })));
  if (flag("--dry-run")) {
    const dir = path.join(OUT_DIR, "dry-run");
    for (const b of built) {
      fs.mkdirSync(path.join(dir, "records"), { recursive: true });
      fs.writeFileSync(path.join(dir, "records", `${b.plan.id}.md`), b.markdown);
    }
    fs.writeFileSync(path.join(dir, "index.md"), `${INDEX_HEADING}\n${built.map((b) => b.index).join("\n")}\n`);
    log(`dry-run：記録の文を ${path.relative(process.cwd(), dir)} に書いた（API は呼んでいない）。札：${tags.join("、")}`);
    return;
  }
  const blocked = before.filter((b) => !b.check.ok);
  if (blocked.length > 0) {
    console.error(JSON.stringify(blocked, null, 2));
    throw new Error("書く前の検査に通らない記録がある。書かずに止める");
  }
  const budgetMinor = option("--session-cap-minor");
  if (!budgetMinor) throw new Error("--session-cap-minor <n> を付けてください（セッション 1 本の費用の上限。最小単位）");

  const client = getClient();
  const state = loadState();
  state.runId ??= stamp();
  const dir = runDirOf(state);
  if (!state.resources) {
    const tag = state.runId.replace(/[^0-9]/g, "").slice(4, 12);
    const names = { environment: `reflectionspark-kenshou-env-${tag}`, agent: `reflectionspark-recorder-kenshou-${tag}`, store: `reflectionspark-memory-kenshou-${tag}` };
    const r = await createRecorderResources(client, { ...names, storeDescription: "ReflectionSpark の記録係と夢の実証（検証用・暫定）。ダミーの面談 6 本の記録。本番のデータではない。" });
    state.resources = { ...r, environmentName: names.environment, agentName: names.agent };
    saveState(state);
    log(`作ったもの：環境 ${names.environment}、エージェント ${names.agent}、メモリストア ${names.store}`);
  }
  state.sessions ??= {};
  const resources = state.resources;
  const runs: Record<string, unknown>[] = [];
  for (const b of built) {
    fs.mkdirSync(path.join(dir, "records"), { recursive: true });
    fs.writeFileSync(path.join(dir, "records", `${b.plan.id}.md`), b.markdown);
    if (state.sessions[b.plan.id]) {
      log(`${b.plan.id}：すでに書かせた（セッションあり）。飛ばす`);
      continue;
    }
    const run = await recordInterview(client, { resources, interviewId: b.plan.id, markdown: b.markdown, indexLineText: b.index, title: `reflectionspark 検証用 記録係 ${b.plan.id}`, budgetMinor, log });
    state.sessions[b.plan.id] = { sessionId: run.sessionId, listCostMinor: run.usage.listCostMinor };
    saveState(state);
    // 読み返して確かめる
    let files = await readStore(client, resources.storeId);
    let stored = checkStoredRecord(files, b.plan.id, b.markdown);
    let fixedByApp = false;
    if (!stored.found || !stored.identical) {
      log(`${b.plan.id}：読み返した文が渡した文と違う（${stored.found ? `最初の違いは ${stored.firstDiff?.line} 行目` : "ファイルが無い"}）。アプリが書き直す`);
      const existing = files.find((f) => f.path === recordPath(b.plan.id));
      if (existing) await client.beta.memoryStores.memories.update(existing.id, { memory_store_id: resources.storeId, content: b.markdown });
      else await client.beta.memoryStores.memories.create(resources.storeId, { path: recordPath(b.plan.id), content: b.markdown });
      fixedByApp = true;
      files = await readStore(client, resources.storeId);
      stored = { ...checkStoredRecord(files, b.plan.id, b.markdown), firstDiff: stored.firstDiff };
    }
    const index = files.find((f) => f.path === INDEX_PATH)?.content ?? "";
    runs.push({
      id: b.plan.id,
      ms: run.ms,
      usage: tokensOf(run.usage),
      toolUses: run.toolUses,
      stopReason: run.stopReason,
      errors: run.errors,
      report: run.report,
      chars: [...b.markdown].length,
      agentWroteIdentical: !fixedByApp,
      fixedByApp,
      firstDiff: fixedByApp ? stored.firstDiff : null,
      storedIdentical: stored.identical,
      traitHitsAfterReadBack: stored.check?.traitHits ?? null,
      nameHitsAfterReadBack: stored.check?.nameHits ?? null,
      indexHasLine: index.split("\n").includes(b.index),
    });
    saveJson(path.join(dir, "record-run.json"), { status: STATUS, model: RECORDER_MODEL, runs });
  }
  const files = await readStore(client, resources.storeId);
  const index = files.find((f) => f.path === INDEX_PATH)?.content ?? "";
  fs.writeFileSync(path.join(dir, "index-after-recording.md"), index.endsWith("\n") ? index : `${index}\n`);
  const expectedIndex = [INDEX_HEADING, ...built.map((b) => b.index)];
  const indexLines = index.trimEnd().split("\n").filter((l) => l.trim() !== "");
  const summary = {
    status: STATUS,
    model: RECORDER_MODEL,
    files: files.map((f) => f.path),
    indexIdentical: JSON.stringify(indexLines) === JSON.stringify(expectedIndex),
    indexLines: indexLines.length,
    runs,
  };
  saveJson(path.join(dir, "record-run.json"), summary);
  console.table(runs.map((r) => ({ id: r.id, ms: r.ms, 同じ文で書けた: r.agentWroteIdentical, 索引に行: r.indexHasLine, 止まり方: r.stopReason })));
  log(`記録 終わり。ストアのファイル：${summary.files.join("、")}。索引は渡した行と同じ：${summary.indexIdentical}`);
}

const BANNER = "> 暫定：検証用の記録（ダミーの面談 6 本）から夢が作った出力。本人は確かめていない。確かめた分析として扱わない。";

async function commandDream(): Promise<void> {
  const cap = Number(option("--cap"));
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--cap <入力トークン換算の上限> を付けてください");
  const client = getClient();
  const state = loadState();
  const dir = runDirOf(state);
  if (!state.resources || !state.sessions) throw new Error("記録がまだ無い。先に record を回す");
  if (state.dream && !flag("--again")) throw new Error(`夢はすでに回した（${state.dream.dreamId}）。回し直すなら --again`);
  const sessionIds = PLAN.map((p) => state.sessions?.[p.id]?.sessionId).filter((s): s is string => !!s);
  if (sessionIds.length !== PLAN.length) throw new Error("記録係のセッションが 6 本そろっていない");
  const instructions = dreamInstructions(PLAN.length);
  const run = await runDream(client, {
    storeId: state.resources.storeId,
    sessionIds,
    instructions,
    capInputEquivalent: cap,
    log,
    onCreated: (dreamId) => {
      state.dream = { dreamId, outputStoreId: null, sessionId: null };
      saveState(state);
    },
  });
  let listCostMinor: string | null = null;
  if (run.sessionId) {
    try {
      const s = await client.beta.sessions.retrieve(run.sessionId);
      listCostMinor = s.usage?.list_cost?.amount ?? null;
    } catch {
      listCostMinor = null;
    }
  }
  state.dream = { dreamId: run.dreamId, outputStoreId: run.outputStoreId, sessionId: run.sessionId, listCostMinor };
  saveState(state);
  const out: Record<string, unknown> = {
    status: STATUS,
    model: DREAM_MODEL,
    dreamStatus: run.status,
    ms: run.ms,
    usage: tokensOf(run.usage),
    inputEquivalent: run.inputEquivalent,
    capInputEquivalent: run.capInputEquivalent,
    canceledByCap: run.canceledByCap,
    error: run.error,
    samples: run.samples,
    instructionsChars: [...instructions].length,
    sessions: sessionIds.length,
  };
  if (run.status === "completed" && run.outputStoreId) {
    const files = await readStore(client, run.outputStoreId);
    const dreamDir = path.join(dir, "dream");
    fs.mkdirSync(dreamDir, { recursive: true });
    const inputFiles = await readStore(client, state.resources.storeId);
    const recordsUnchanged = inputFiles.filter((f) => f.path.startsWith("/records/")).map((f) => ({ path: f.path, unchanged: files.find((o) => o.path === f.path)?.content === f.content }));
    for (const f of files) {
      if (f.path.startsWith("/records/")) continue;
      const name = f.path.slice(1).replace(/\//g, "__");
      fs.writeFileSync(path.join(dreamDir, name), `${BANNER}\n\n${f.content.trimEnd()}\n`);
    }
    out.outputFiles = files.map((f) => ({ path: f.path, chars: [...f.content].length }));
    out.recordsUnchanged = recordsUnchanged;
    out.expectedFilesPresent = Object.fromEntries(Object.entries(DREAM_FILES).map(([k, p]) => [k, files.some((f) => f.path === p)]));
  }
  fs.writeFileSync(path.join(dir, "dream-instructions.md"), `> 検証用：この回の夢に渡した指示（engine/recorder.mts の dreamInstructions）。\n\n${instructions}\n`);
  saveJson(path.join(dir, "dream-run.json"), out);
  log(`夢 終わり：${run.status}、${run.ms} ms、入力トークン換算 ${run.inputEquivalent}（上限 ${cap}）`);
  console.log(JSON.stringify({ usage: tokensOf(run.usage), files: out.outputFiles, recordsUnchanged: out.recordsUnchanged }, null, 2));
}

/** 短い期間から変化を言い切る言葉（夢への指示の 7）。「」の中と、発話の本文の行は数えない */
const GROWTH = /成長し|身につい|できるようになっ|上達し|改善し|克服し/gu;

function growthHits(markdown: string): string[] {
  const body = markdown
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .replace(/「[^」]*」/g, "");
  return [...body.matchAll(GROWTH)].map((m) => body.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 24).replace(/\n/g, " "));
}

function commandVerify(): void {
  const state = loadState();
  const dir = runDirOf(state);
  const dreamDir = path.join(dir, "dream");
  if (!fs.existsSync(dreamDir)) throw new Error("夢の出力がまだ無い。先に dream を回す");
  const analyses = loadAnalyses();
  const transcripts = Object.fromEntries(analyses.map((a) => [a.id, a.transcript.utterances]));
  const names = fs.readdirSync(dreamDir).filter((f) => f.endsWith(".md")).sort();
  const perFile: Record<string, unknown>[] = [];
  const allChecks: (EvidenceCheck & { file: string })[] = [];
  for (const name of names) {
    const md = fs.readFileSync(path.join(dreamDir, name), "utf8");
    const checks = verifyEvidence(parseEvidenceRefs(md), transcripts).map((c) => ({ ...c, file: name }));
    allChecks.push(...checks);
    const trait = checkMarkdown(md, name);
    perFile.push({ file: name, chars: [...md].length, evidence: summarizeEvidence(checks), traitHits: trait.traitHits, growthHits: growthHits(md), provisionalOnFirstLine: /暫定/.test(md.split("\n").filter((l) => l.trim() !== "" && !l.startsWith(">"))[0] ?? "") });
  }
  const recurringName = DREAM_FILES.recurring.slice(1);
  const recurring = names.includes(recurringName) ? fs.readFileSync(path.join(dreamDir, recurringName), "utf8") : "";
  const hypotheses = parseHypotheses(recurring);
  const hypothesisRows = hypotheses.map((h) => {
    const ev = verifyEvidence(h.evidence, transcripts);
    const co = verifyEvidence(h.counter, transcripts);
    return {
      id: h.id,
      statement: h.statement,
      confidence: h.confidence,
      interviews: h.interviews,
      evidence: ev.length,
      evidenceMatched: ev.filter((c) => c.status === "全文一致" || c.status === "一部一致").length,
      counter: co.length,
      counterMatched: co.filter((c) => c.status === "全文一致" || c.status === "一部一致").length,
      counterNote: h.counterNote,
    };
  });
  const result = {
    status: STATUS,
    files: perFile,
    evidence: summarizeEvidence(allChecks),
    hypotheses: summarizeHypotheses(hypotheses),
    hypothesisRows,
    checks: allChecks,
  };
  saveJson(path.join(dir, "evidence.json"), result);
  const cell = (s: string) => s.replace(/\|/g, "｜").replace(/\n/g, " ");
  const md = `# 夢の出力の根拠と、発話の原文の照合（${state.runId}）

${BANNER.replace("夢が作った出力", "夢の出力を、プログラムで原文と照合した結果")}

照合で分かるのは「その面談のその番号の発話に、その言葉がある」ことまで。その発話が仮説を支えるかは、この表では分からない。

## 数

- 根拠の数：${result.evidence.total}（引用つき ${result.evidence.withQuote}）
- 番号も言葉も原文と合った：${result.evidence.matched}
- 内訳：${Object.entries(result.evidence.byStatus).map(([k, v]) => `${k} ${v}`).join("、")}
- 話者が違った：${result.evidence.speakerMismatch}
- 仮説：${result.hypotheses.total}（根拠が 2 回以上の面談にまたがる ${result.hypotheses.acrossInterviews}、反例を発話つきで挙げた ${result.hypotheses.withCounterEvidence}、反例の欄が文だけ ${result.hypotheses.withCounterNoteOnly}、反例の欄が空 ${result.hypotheses.withoutCounter}）
- 確からしさ：${Object.entries(result.hypotheses.byConfidence).map(([k, v]) => `${k} ${v}`).join("、")}

## ファイルごと

| ファイル | 字数 | 根拠 | 合った | 性質の言葉 | 変化を言い切る言葉 | 1 行目に暫定 |
|---|---|---|---|---|---|---|
${perFile.map((f) => `| ${f.file} | ${f.chars} | ${(f.evidence as { total: number }).total} | ${(f.evidence as { matched: number }).matched} | ${(f.traitHits as unknown[]).length} | ${(f.growthHits as unknown[]).length} | ${f.provisionalOnFirstLine ? "あり" : "なし"} |`).join("\n")}

## 仮説ごと

| 仮説 | 確からしさ | 根拠の面談 | 根拠（合った／数） | 反例（合った／数） | 反例の欄の文 |
|---|---|---|---|---|---|
${hypothesisRows.map((h) => `| ${h.id}：${cell(h.statement)} | ${h.confidence ?? "（読めない）"} | ${h.interviews.join("、")} | ${h.evidenceMatched}／${h.evidence} | ${h.counterMatched}／${h.counter} | ${cell(h.counterNote)} |`).join("\n")}

## 根拠の一覧（その番号の発話の話者と本文を並べる）

| ファイル | 行 | 面談 | 発話 | 結果 | 夢が書いた話者と引用 | その番号の発話（原文） |
|---|---|---|---|---|---|---|
${allChecks
  .map((c) => `| ${c.file} | ${c.line} | ${c.interviewId} | ${c.index === c.lastIndex ? c.index : `${c.index}〜${c.lastIndex}`} | ${c.status}${c.speakerMatches === false ? "・話者ちがい" : ""}${c.foundAt.length > 0 ? `（${c.foundAt.map((f) => `${f.interviewId} 発話 ${f.index}`).join("、")} にある）` : ""} | ${cell(`${c.speaker ?? ""}：${c.quote ?? "（引用なし）"}`)} | ${cell((c.actual ?? []).map((a) => `${a.speaker}：${a.text}`).join(" ／ ") || "—")} |`)
  .join("\n")}
`;
  fs.writeFileSync(path.join(dir, "evidence.md"), md);
  console.log(JSON.stringify({ evidence: result.evidence, hypotheses: result.hypotheses, files: perFile.map((f) => ({ file: f.file, trait: (f.traitHits as unknown[]).length, growth: (f.growthHits as unknown[]).length })) }, null, 2));
  log(`照合 終わり：${path.relative(process.cwd(), path.join(dir, "evidence.md"))}`);
}

/** 時間・トークン数・失敗とやり直しを、1 つの表にまとめる（金額は書かない） */
function commandSummary(): void {
  const state = loadState();
  const dir = runDirOf(state);
  const analyses = loadAnalyses();
  type Row = { step: string; model: string; calls: number; ms: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; note: string };
  const add = (row: Row, m: CallMeta) => {
    row.calls++;
    row.ms += m.ms;
    row.inputTokens += m.inputTokens;
    row.outputTokens += m.outputTokens;
    row.cacheReadTokens += m.cacheReadTokens;
    row.cacheWriteTokens += m.cacheWriteTokens;
  };
  const empty = (step: string, model: string, note: string): Row => ({ step, model, calls: 0, ms: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, note });
  const rows: Row[] = [];
  const analysisNote = "今回回した呼び出しだけ。6 本を同時に回したので、時間は呼び出しごとの合計";
  const byStep: Record<string, Row> = {};
  const perInterview = analyses.map((a) => {
    const fresh: { step: string; meta: CallMeta }[] = [];
    if (a.source.step0 === "今回") a.timing.step0.forEach((m, i) => fresh.push({ step: i === 0 ? "工程 0a" : "工程 0b", meta: m }));
    if (a.source.step1 === "今回") fresh.push({ step: "工程 1", meta: a.timing.step1 });
    if (a.source.step2 === "今回" && a.timing.step2) fresh.push({ step: "工程 2", meta: a.timing.step2 });
    if (a.source.step4 === "今回" && a.timing.step4) fresh.push({ step: "工程 4", meta: a.timing.step4 });
    for (const f of fresh) add((byStep[f.step] ??= empty(`分析：${f.step}`, f.meta.model, analysisNote)), f.meta);
    return { id: a.id, source: a.source, utterances: a.transcript.utterances.length, scenes: a.step1.scenes.length, verdict: a.step4?.verdict ?? null, freshCalls: fresh.length, failures: a.failures };
  });
  rows.push(...Object.keys(byStep).sort().map((k) => byStep[k]));
  const rec = loadJson<{ model: string; indexIdentical: boolean; runs: { id: string; ms: number; usage: Omit<CallMeta, "model" | "ms">; agentWroteIdentical: boolean; fixedByApp: boolean; errors: string[]; indexHasLine: boolean; toolUses: Record<string, number>; traitHitsAfterReadBack: unknown[] | null; nameHitsAfterReadBack: unknown[] | null }[] }>(path.join(dir, "record-run.json"));
  if (rec) {
    const row = empty("記録係（セッション 6 本。1 本ずつ順番に）", rec.model, "時間はセッションを作ってから止まるまで");
    for (const r of rec.runs) add(row, { model: rec.model, ms: r.ms, ...r.usage });
    rows.push(row);
  }
  const dream = loadJson<{ model: string; dreamStatus: string; ms: number; usage: Omit<CallMeta, "model" | "ms">; inputEquivalent: number; capInputEquivalent: number; canceledByCap: boolean; error: string | null; recordsUnchanged?: { path: string; unchanged: boolean }[]; expectedFilesPresent?: Record<string, boolean> }>(path.join(dir, "dream-run.json"));
  if (dream) {
    const row = empty("夢（1 回）", dream.model, `終わり方 ${dream.dreamStatus}。入力トークン換算 ${dream.inputEquivalent}（上限 ${dream.capInputEquivalent}）`);
    add(row, { model: dream.model, ms: dream.ms, ...dream.usage });
    rows.push(row);
  }
  const evidence = loadJson<{ evidence: unknown; hypotheses: unknown; files: { file: string; traitHits: unknown[]; growthHits: unknown[] }[] }>(path.join(dir, "evidence.json"));
  const failures = {
    analysisRetries: perInterview.flatMap((p) => p.failures),
    recorderErrors: rec ? rec.runs.flatMap((r) => r.errors.map((e) => `${r.id}：${e}`)) : [],
    recorderRewrittenByApp: rec ? rec.runs.filter((r) => r.fixedByApp).map((r) => r.id) : [],
    recorderTraitOrNameHitsAfterReadBack: rec ? rec.runs.filter((r) => (r.traitHitsAfterReadBack?.length ?? 0) + (r.nameHitsAfterReadBack?.length ?? 0) > 0).map((r) => r.id) : [],
    dreamCanceled: dream ? dream.canceledByCap || dream.dreamStatus !== "completed" : null,
    dreamError: dream?.error ?? null,
    dreamChangedRecords: dream?.recordsUnchanged ? dream.recordsUnchanged.filter((r) => !r.unchanged).map((r) => r.path) : null,
  };
  const summary = { status: STATUS, runId: state.runId, interviews: perInterview, steps: rows, recorder: rec ? { indexIdentical: rec.indexIdentical, runs: rec.runs.map((r) => ({ id: r.id, ms: r.ms, usage: r.usage, toolUses: r.toolUses, agentWroteIdentical: r.agentWroteIdentical, indexHasLine: r.indexHasLine })) } : null, dream, evidence: evidence ? { evidence: evidence.evidence, hypotheses: evidence.hypotheses, traitHits: evidence.files.reduce((n, f) => n + f.traitHits.length, 0), growthHits: evidence.files.reduce((n, f) => n + f.growthHits.length, 0) } : null, failures };
  saveJson(path.join(dir, "summary.json"), summary);
  const sec = (ms: number) => (ms / 1000).toFixed(1);
  const md = `# 時間・トークン数・失敗とやり直し（${state.runId}）

> 検証用・暫定：ダミーの面談 6 本で回した記録係と夢の実証の数字。金額は書かない（トークン数と時間だけ）。

## 段ごと

| 段 | モデル | 呼び出し | 時間（秒） | 入力 | 出力 | キャッシュ読み | キャッシュ書き | 備考 |
|---|---|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.step} | ${r.model} | ${r.calls} | ${sec(r.ms)} | ${r.inputTokens} | ${r.outputTokens} | ${r.cacheReadTokens} | ${r.cacheWriteTokens} | ${r.note} |`).join("\n")}

## 面談ごと（分析）

| 面談 | 発話 | 場面 | 追跡の判定 | 今回回した呼び出し | 整形 | 工程 1 | やり直し |
|---|---|---|---|---|---|---|---|
${perInterview.map((p) => `| ${p.id} | ${p.utterances} | ${p.scenes} | ${p.verdict ?? "—"} | ${p.freshCalls} | ${p.source.step0} | ${p.source.step1} | ${p.failures.length} |`).join("\n")}

## 記録係（セッションごと）

| 面談 | 時間（秒） | 入力 | 出力 | キャッシュ読み | キャッシュ書き | 道具 | 渡した文と同じに書けた | 索引に 1 行 |
|---|---|---|---|---|---|---|---|---|
${(rec?.runs ?? []).map((r) => `| ${r.id} | ${sec(r.ms)} | ${r.usage.inputTokens} | ${r.usage.outputTokens} | ${r.usage.cacheReadTokens} | ${r.usage.cacheWriteTokens} | ${Object.entries(r.toolUses).map(([k, v]) => `${k} ${v}`).join("、")} | ${r.agentWroteIdentical ? "はい" : "いいえ（アプリが書き直した）"} | ${r.indexHasLine ? "はい" : "いいえ"} |`).join("\n")}

- 索引は、渡した 6 行と見出しだけか：${rec?.indexIdentical ? "はい" : "いいえ"}

## 失敗とやり直し

- 分析のやり直し：${failures.analysisRetries.length} 件${failures.analysisRetries.length > 0 ? `（${failures.analysisRetries.join("／")}）` : ""}
- 記録係のセッションのエラー：${failures.recorderErrors.length} 件
- 記録係が渡した文と違う文を書き、アプリが書き直した：${failures.recorderRewrittenByApp.length} 件
- 読み返しで、性質の言葉か名前が見つかった記録：${failures.recorderTraitOrNameHitsAfterReadBack.length} 件
- 夢の取り消し・失敗：${failures.dreamCanceled === null ? "（夢はまだ）" : failures.dreamCanceled ? "あり" : "なし"}${failures.dreamError ? `（${failures.dreamError}）` : ""}
- 夢が書き換えた記録のファイル：${failures.dreamChangedRecords === null ? "（夢はまだ）" : `${failures.dreamChangedRecords.length} 件`}
`;
  fs.writeFileSync(path.join(dir, "summary.md"), md);
  log(`まとめ：${path.relative(process.cwd(), path.join(dir, "summary.md"))}`);
  console.log(md);
}

try {
  if (command === "analyze") await commandAnalyze();
  else if (command === "summary") commandSummary();
  else if (command === "record") await commandRecord();
  else if (command === "dream") await commandDream();
  else if (command === "verify") commandVerify();
  else throw new Error("使い方：node scripts/memory/run.mts analyze | record | dream | verify | summary");
} catch (e) {
  console.error(`止まりました：${(e as Error).message}`);
  process.exit(1);
}

