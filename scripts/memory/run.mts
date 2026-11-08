// サンプルの講師の記録を作る。docs/設計書.md「覚えていると整理」。
// ダミーの面談のうち過去 4 回（山場の 2 回は入れない）の分析を、記録係に 1 回 1 ファイルで書かせ（①）、夢を 1 回回し、
// 夢の出力の根拠を発話の原文と照合する。点と判定と自己採点は、別のストア（②）にスクリプトが直接書く。
// どの出力も暫定。本人が確かめた分析として扱わない。
//
// 使い方（API キーは環境変数。値はファイルに書かない）：
//   node scripts/memory/run.mts analyze                 4 回の分析（保存した結果があれば使う。--fresh で回し直す）
//   node scripts/memory/run.mts record --state <file> --session-cap-minor <n> [--dry-run] [--no-reading] [--names-file <file>]
//   node scripts/memory/run.mts record --state <file> --verify-only [--names-file <file>]   ストアを読むだけで確かめる
//   node scripts/memory/run.mts scores --state <file> [--dry-run]   点の控え（②）を書く。LLM は呼ばない
//   node scripts/memory/run.mts dream  --state <file> --cap <入力トークン換算の上限> [--again]
//   node scripts/memory/run.mts correct --state <file> --interview <面談> --old <直す文> --new <直した文>
//   node scripts/memory/run.mts verify --state <file>
//   node scripts/memory/run.mts summary --state <file>   時間・トークン数・失敗とやり直しの表
// --state は、作ったリソースの ID を控えるファイル（リポジトリの外に置く。ID と金額はリポジトリに入れない）。
// --names-file は、相手の名前の一覧（1 行 1 つ。リポジトリの外に置く）。渡さなければ、名前の検査は「未検査」になる。
// 記録の形を変えて回すときは、同じストアに混ぜないよう、新しい --state にする（形が違う --state では止まる）。
// 出力：eval/results/memory/analysis/<面談>.json、eval/results/memory/<実行の印>/…

import fs from "node:fs";
import path from "node:path";

import { getClient } from "../../engine/claude.mts";
import { causalHits, counterOverlaps, parseEvidenceRefs, parseHypotheses, summarizeEvidence, summarizeHypotheses, uniqueUtterances, verificationClaims, verifyEvidence } from "../../engine/memory-evidence.mts";
import type { EvidenceCheck, TextHit } from "../../engine/memory-evidence.mts";
import { checkCorrectionKept, dreamBlockers, hasIndexLine, indexProblems, nextRecordStep, sessionIdsForDream, storedProblems } from "../../engine/memory-gate.mts";
import type { SavedCorrection, SessionEntry } from "../../engine/memory-gate.mts";
import { applyCorrection, buildFactRecord, checkMarkdown, checkRecord, indexLine, INDEX_PATH, nameCheckLabel, RECORD_FORMAT, recordPath, renderRecord } from "../../engine/memory-record.mts";
import type { FactRecord, RenderOptions } from "../../engine/memory-record.mts";
import { checkStoredRecord, createRecorderResources, DREAM_FILES, DREAM_MODEL, dreamInstructions, INDEX_HEADING, readStore, RECORDER_MODEL, recordInterview, runDream } from "../../engine/recorder.mts";
import type { RecorderResources, RecordRun, SessionUsage, StoredFile } from "../../engine/recorder.mts";
import { buildLedgerEntry, ledgerPath, ledgerTotal, renderLedgerEntry } from "../../engine/score-ledger.mts";
import type { LedgerEntry } from "../../engine/score-ledger.mts";
import { runStep0 } from "../../engine/step0.mts";
import { runStep1 } from "../../engine/step1.mts";
import { runStep2 } from "../../engine/step2.mts";
import { runStep4 } from "../../engine/step4.mts";
import type { CallMeta, Spark, Step1Result, Step2Result, Step4Result, Transcript } from "../../engine/types.mts";
import { loadCase, loadJson, saveJson, stamp } from "../../eval/lib/cases.mts";
import { SAMPLE_SELF, SAMPLE_SELF_CONFIRMED } from "./sample-self-scores.mts";

const STATUS = "サンプル・暫定（作ったダミーの面談。本人は確かめていない）";
const OUT_DIR = path.resolve("eval/results/memory");
const ANALYSIS_DIR = path.join(OUT_DIR, "analysis");

type Plan = { id: string; date: string; order: number; other: string; follows: string | null; followedBy: string | null };
/**
 * サンプルの講師の過去 4 回。日付は台本の手がかりに合わせた作りもの。
 * 山場の 2 回（2026-06-19、2026-07-28）は入れない。入れると、山場 1 回目の画面 3 に、あとの回の発言が出うる。
 */
const PLAN: Plan[] = [
  { id: "student-seiseki", date: "2025-10-24", order: 1, other: "相手 B", follows: null, followedBy: "student-seiseki-2" },
  { id: "student-yaruki", date: "2025-10-28", order: 2, other: "相手 C", follows: null, followedBy: "student-yaruki-2" },
  { id: "student-yaruki-2", date: "2025-11-18", order: 3, other: "相手 C", follows: "student-yaruki", followedBy: null },
  { id: "student-seiseki-2", date: "2025-11-21", order: 4, other: "相手 B", follows: "student-seiseki", followedBy: null },
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
  /** この --state で書いている記録の形の版（engine/memory-record.mts の RECORD_FORMAT） */
  recordFormat?: number;
  /** 点の控え（②）のストア。セッションにも夢にも付けない */
  scoresStoreId?: string;
  resources?: RecorderResources & { environmentName: string; agentName: string };
  sessions?: Record<string, SessionEntry>;
  /** 索引の全体が、見出しと渡した行だけと確かめたか */
  indexVerified?: boolean;
  indexProblems?: string[];
  /** 本人が直した記録（夢に渡すセッションから外す。夢のあとで守られたかを確かめる） */
  corrections?: SavedCorrection[];
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

/** 記録の中身の出し分け。既定は読みも入れる。点と判定は、どの形でも入らない */
const renderOptions = (): RenderOptions => ({ includeAiReading: !flag("--no-reading") });

/** 相手の名前の一覧。渡さなければ空で、名前の検査は「未検査」になる */
function namesFromFile(): string[] {
  const p = option("--names-file");
  if (!p) return [];
  return fs.readFileSync(path.resolve(p), "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

/** サンプルとして置いた行動の決まり方。本人が選んだものとして残さない */
const PLACED_ACTION_ORIGIN = "サンプルとして置いた（評価の正解にある「前回の一手」。本人が選んだものではない）";

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
  const step0Meta: CallMeta[] = [];
  const r = await retry(`${p.id} 工程 0`, failures, () => runStep0(c.raw, c.kind, { log: (s) => log(`${p.id} ${s}`) }));
  const transcript: Transcript = r.transcript;
  const step0Source = "今回";
  step0Meta.push(r.timing.step0a, ...(r.timing.step0b ? [r.timing.step0b] : []));
  log(`${p.id} 工程 0：${transcript.utterances.length} 発話、当て直せなかった所 ${r.unanchored}`);

  const step1: Step1Result = await retry(`${p.id} 工程 1`, failures, () => runStep1(transcript));
  const step1Source = "今回";
  log(`${p.id} 工程 1：${step1.meta.ms} ms、場面 ${step1.scenes.length}、引用 生成 ${step1.quoteStats.generated}・捨てた ${step1.quoteStats.discarded}`);
  let step2: Step2Result | null = null;
  let step2Source: string | null = null;
  if (!p.follows) {
    step2 = await retry(`${p.id} 工程 2`, failures, () => runStep2(transcript, step1.scenes, { firstMeeting: true }));
    step2Source = "今回";
    log(`${p.id} 工程 2：${step2.meta.ms} ms、${step2.items.map((i) => `${i.item}:${i.score ?? "判定しない"}`).join(" ")}`);
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

/** 分析の結果から、記録を作る。渡すのは日付と、場面・引用・行動だけ（自己採点・自己評価と、AI の点・判定は、ここに来ない。決まり 10） */
function buildRecords(analyses: Analysis[]): { plan: Plan; record: FactRecord; markdown: string; index: string }[] {
  return PLAN.map((p) => {
    const a = analyses.find((x) => x.id === p.id) as Analysis;
    const next = p.followedBy ? sparkFor(p.followedBy) : null;
    const record = buildFactRecord({
      interviewId: p.id,
      date: p.date,
      kind: a.transcript.kind,
      order: p.order,
      otherTag: p.other,
      followsInterviewId: p.follows,
      status: STATUS,
      utterances: a.transcript.utterances,
      step1: { scenes: a.step1.scenes, noScene: a.step1.noScene },
      chosenAction: next ? { sentence: next.sentence, criterion: next.criterion, origin: PLACED_ACTION_ORIGIN } : null,
      followUp:
        p.follows && a.step4 && a.spark
          ? {
              previousInterviewId: p.follows,
              previousAction: a.spark.sentence,
              previousActionOrigin: PLACED_ACTION_ORIGIN,
              criterion: a.spark.criterion,
              quotes: a.step4.quotes,
              otherPersonLine: a.step4.otherPersonLine,
            }
          : null,
    });
    return { plan: p, record, markdown: renderRecord(record, renderOptions()), index: indexLine(record) };
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

/** ストアのファイルを、あれば書き換え、無ければ作る（アプリが直すとき） */
async function writeStoreFile(client: ReturnType<typeof getClient>, storeId: string, files: StoredFile[], filePath: string, content: string): Promise<void> {
  const existing = files.find((f) => f.path === filePath);
  if (existing) await client.beta.memoryStores.memories.update(existing.id, { memory_store_id: storeId, content });
  else await client.beta.memoryStores.memories.create(storeId, { path: filePath, content });
}

const indexOf = (files: StoredFile[]) => files.find((f) => f.path === INDEX_PATH)?.content ?? "";

/** 前の形の --state（前のストア）に、続けて書かない。既存のストアを変えないための止め */
function assertSameRecordFormat(state: State): void {
  if (state.resources && state.recordFormat !== RECORD_FORMAT) throw new Error(`この --state は記録の形 ${state.recordFormat ?? "（記録なし）"} のストアです。今の形は ${RECORD_FORMAT}。新しい --state で回してください`);
}

/** 点の控え（②）の 1 回分を、分析と本人の自己採点から作る。AI の点は、続きの回は工程 4、それ以外は工程 2 のもの */
function buildLedger(analyses: Analysis[]): LedgerEntry[] {
  return PLAN.map((p) => {
    const a = analyses.find((x) => x.id === p.id) as Analysis;
    const self = SAMPLE_SELF[p.id];
    if (!self) throw new Error(`${p.id} の自己採点の案が無い`);
    return buildLedgerEntry({ interviewId: p.id, date: p.date, self, aiItems: (p.follows ? a.step4?.items : a.step2?.items) ?? [], aiVerdict: p.follows ? a.step4?.verdict ?? null : null });
  });
}

/**
 * 点の控え（②）を書く。スクリプトが直接書き、記録係のセッションを通さない（夢はセッションの中身も読むので、通すと点が夢に届く）。
 * LLM は呼ばない。本人が自己採点の案を確かめるまで書かない。
 */
async function commandScores(): Promise<void> {
  const entries = buildLedger(loadAnalyses());
  console.table(entries.map((e) => ({ id: e.interviewId, 日付: e.date, 自分の点: e.selfScore, AI: ledgerTotal(e).scaled, 差: Math.round((e.selfScore - (ledgerTotal(e).scaled ?? 0)) * 10) / 10, 自己評価: e.selfVerdict ?? "—", "AI の判定": e.aiVerdict ?? "—", 一言: e.selfNote })));
  if (flag("--dry-run")) return;
  if (!SAMPLE_SELF_CONFIRMED) throw new Error("自己採点の案を本人が確かめていないので、書かない（scripts/memory/sample-self-scores.mts）");
  const client = getClient();
  const state = loadState();
  assertSameRecordFormat(state);
  if (!state.scoresStoreId) {
    const tag = stamp().replace(/[^0-9]/g, "").slice(4, 12);
    const store = await client.beta.memoryStores.create({ name: `reflectionspark-scores-sample-${tag}`, description: "ReflectionSpark のサンプルの講師の点の控え（自己採点と一言、自己評価、AI の点と判定）。作ったダミーの面談 4 回。アプリだけが読み書きする。セッションにも夢にも付けない。" });
    state.scoresStoreId = store.id;
    saveState(state);
    log(`作ったもの：点の控えのメモリストア ${store.name}`);
  }
  if (state.scoresStoreId === state.resources?.storeId) throw new Error("記録のストアと点の控えのストアが同じ。止める（決まり 10）");
  let files = await readStore(client, state.scoresStoreId);
  for (const e of entries) await writeStoreFile(client, state.scoresStoreId, files, ledgerPath(e.interviewId, e.date), renderLedgerEntry(e));
  files = await readStore(client, state.scoresStoreId);
  const problems = entries.filter((e) => files.find((f) => f.path === ledgerPath(e.interviewId, e.date))?.content.trimEnd() !== renderLedgerEntry(e).trimEnd()).map((e) => e.interviewId);
  if (problems.length > 0) throw new Error(`点の控えの読み返しが合わない：${problems.join("、")}`);
  log(`点の控え 終わり：${files.length} ファイルを読み返して同じと確かめた`);
}

async function commandRecord(): Promise<void> {
  const names = namesFromFile();
  const analyses = loadAnalyses();
  const built = buildRecords(analyses);
  const tags = [...new Set(PLAN.map((p) => p.other))];
  // 書く前の検査：性質の言葉と名前。札（相手 A など）は名前ではないので、名前の一覧には入れない
  const before = built.map((b) => {
    const check = checkRecord(b.record, names, renderOptions());
    const text = checkMarkdown(b.markdown, b.plan.id, names);
    return { id: b.plan.id, check, text, dropped: b.record.dropped, chars: [...b.markdown].length };
  });
  console.table(before.map((b) => ({ id: b.id, 字数: b.chars, 性質の言葉: b.check.traitHits.length + b.text.traitHits.length, 点と判定: b.check.scoreHits.length + b.text.scoreHits.length, 名前: nameCheckLabel(names.length, b.check.nameHits.length), 合わず捨てた引用: b.dropped.unverifiedQuotes, 控えた欄: b.dropped.withheldFields.length })));
  if (flag("--dry-run")) {
    const dir = path.join(OUT_DIR, "dry-run");
    for (const b of built) {
      fs.mkdirSync(path.join(dir, "records"), { recursive: true });
      fs.writeFileSync(path.join(dir, "records", `${b.plan.date}-${b.plan.id}.md`), b.markdown);
    }
    fs.writeFileSync(path.join(dir, "index.md"), `${INDEX_HEADING}\n${built.map((b) => b.index).join("\n")}\n`);
    log(`dry-run：記録の文を ${path.relative(process.cwd(), dir)} に書いた（API は呼んでいない）。札：${tags.join("、")}`);
    return;
  }
  const blocked = before.filter((b) => !b.check.ok || !b.text.ok);
  if (blocked.length > 0) {
    console.error(JSON.stringify(blocked, null, 2));
    throw new Error("書く前の検査に通らない記録がある。書かずに止める");
  }
  const budgetMinor = option("--session-cap-minor");
  if (!budgetMinor) throw new Error("--session-cap-minor <n> を付けてください（セッション 1 本の費用の上限。最小単位）");

  const client = getClient();
  const state = loadState();
  assertSameRecordFormat(state);
  state.runId ??= stamp();
  state.recordFormat = RECORD_FORMAT;
  const dir = runDirOf(state);
  if (!state.resources) {
    const tag = state.runId.replace(/[^0-9]/g, "").slice(4, 12);
    const resourceNames = { environment: `reflectionspark-sample-env-${tag}`, agent: `reflectionspark-recorder-sample-${tag}`, store: `reflectionspark-memory-sample-${tag}` };
    const r = await createRecorderResources(client, { ...resourceNames, storeDescription: "ReflectionSpark のサンプルの講師の記録（場面と行動）。作ったダミーの面談 4 回。実在の人物のデータではない。点と判定は入れない。" });
    state.resources = { ...r, environmentName: resourceNames.environment, agentName: resourceNames.agent };
    saveState(state);
    log(`作ったもの：環境 ${resourceNames.environment}、エージェント ${resourceNames.agent}、メモリストア ${resourceNames.store}`);
  }
  state.sessions ??= {};
  const sessions = state.sessions;
  const resources = state.resources;
  const runFile = path.join(dir, "record-run.json");
  // 前に止まった回の記録を消さない。同じ面談は、新しい結果で置き換える
  const runs: Record<string, unknown>[] = loadJson<{ runs: Record<string, unknown>[] }>(runFile)?.runs ?? [];
  const putRun = (row: Record<string, unknown>) => {
    const i = runs.findIndex((r) => r.id === row.id);
    if (i >= 0) runs[i] = row;
    else runs.push(row);
    saveJson(runFile, { status: STATUS, model: RECORDER_MODEL, nameCheck: nameCheckLabel(names.length, 0), runs });
  };
  const corrected = new Set((state.corrections ?? []).map((c) => c.interviewId));
  fs.mkdirSync(path.join(dir, "records"), { recursive: true });
  for (const b of built) {
    const id = b.plan.id;
    if (corrected.has(id)) {
      log(`${id}：本人が直した記録。書き直さない`);
      continue;
    }
    const localFile = path.join(dir, "records", `${b.plan.date}-${id}.md`);
    const entry = sessions[id];
    // 前に渡した文を、違う形で上書きしない（同じストアに、形の違う記録を混ぜない）
    if (entry && fs.existsSync(localFile) && fs.readFileSync(localFile, "utf8") !== b.markdown) {
      throw new Error(`${id}：記録の文が、前に渡した時と違う。同じストアに混ぜないよう、新しい --state で回す`);
    }
    fs.writeFileSync(localFile, b.markdown);
    let files = await readStore(client, resources.storeId);
    const step = nextRecordStep(entry, files.some((f) => f.path === recordPath(id, b.plan.date)));
    if (step === "skip") {
      log(`${id}：保存を確かめてある。飛ばす`);
      continue;
    }
    let run: RecordRun | null = null;
    if (step === "session") {
      run = await recordInterview(client, {
        resources,
        interviewId: id,
        date: b.plan.date,
        markdown: b.markdown,
        indexLineText: b.index,
        title: `reflectionspark サンプル 記録係 ${id}`,
        budgetMinor,
        log,
        onCreated: (sessionId) => {
          sessions[id] = { sessionId, listCostMinor: null, verified: false, problems: ["まだ確かめていない"] };
          saveState(state);
        },
      });
      sessions[id] = { sessionId: run.sessionId, listCostMinor: run.usage.listCostMinor, verified: false, problems: ["まだ確かめていない"] };
      saveState(state);
      files = await readStore(client, resources.storeId);
    } else {
      log(`${id}：セッションと記録のファイルがある。新しいセッションを増やさず、確かめ直す`);
    }
    // 読み返して確かめる。違っていればアプリが直し、もう一度確かめる
    let stored = checkStoredRecord(files, id, b.plan.date, b.markdown, names);
    const firstDiff = stored.firstDiff;
    let fixedByApp = false;
    if (!stored.found || !stored.identical) {
      log(`${id}：読み返した文が渡した文と違う（${stored.found ? `最初の違いは ${stored.firstDiff?.line} 行目` : "ファイルが無い"}）。アプリが書き直す`);
      await writeStoreFile(client, resources.storeId, files, recordPath(id, b.plan.date), b.markdown);
      fixedByApp = true;
      files = await readStore(client, resources.storeId);
      stored = checkStoredRecord(files, id, b.plan.date, b.markdown, names);
    }
    let indexFixedByApp = false;
    if (!hasIndexLine(indexOf(files), b.index)) {
      log(`${id}：索引に行が無い。アプリが足す`);
      const current = indexOf(files).trimEnd();
      await writeStoreFile(client, resources.storeId, files, INDEX_PATH, `${current === "" ? INDEX_HEADING : current}\n${b.index}\n`);
      indexFixedByApp = true;
      files = await readStore(client, resources.storeId);
    }
    const indexHasLine = hasIndexLine(indexOf(files), b.index);
    const sessionErrors = run?.errors ?? [];
    const problems = [...storedProblems(stored, indexHasLine), ...sessionErrors.map((e) => `セッションのエラー：${e.slice(0, 120)}`)];
    sessions[id] = { ...sessions[id], verified: problems.length === 0, problems };
    saveState(state);
    putRun({
      id,
      ms: run?.ms ?? null,
      usage: run ? tokensOf(run.usage) : null,
      toolUses: run?.toolUses ?? {},
      stopReason: run?.stopReason ?? null,
      errors: run?.errors ?? [],
      interruptRequested: run?.interruptRequested ?? false,
      report: run?.report ?? "",
      chars: [...b.markdown].length,
      agentWroteIdentical: !fixedByApp,
      fixedByApp,
      firstDiff: fixedByApp ? firstDiff : null,
      storedIdentical: stored.identical,
      traitHitsAfterReadBack: stored.check?.traitHits ?? null,
      scoreHitsAfterReadBack: stored.check?.scoreHits ?? null,
      nameHitsAfterReadBack: stored.check?.nameHits ?? null,
      indexHasLine,
      indexFixedByApp,
      verified: problems.length === 0,
      problems,
    });
    if (problems.length > 0) throw new Error(`${id}：保存の検査に通らない（${problems.join("、")}）。ここで止める。直してから同じコマンドで続きを回す`);
  }
  let files = await readStore(client, resources.storeId);
  const expectedLines = built.map((b) => b.index);
  let iProblems = indexProblems(indexOf(files), INDEX_HEADING, expectedLines);
  let indexRewrittenByApp = false;
  if (iProblems.length > 0) {
    log(`索引が渡した行と合わない（${iProblems.join("、")}）。アプリが書き直す`);
    await writeStoreFile(client, resources.storeId, files, INDEX_PATH, `${[INDEX_HEADING, ...expectedLines].join("\n")}\n`);
    indexRewrittenByApp = true;
    files = await readStore(client, resources.storeId);
    iProblems = indexProblems(indexOf(files), INDEX_HEADING, expectedLines);
  }
  state.indexVerified = iProblems.length === 0;
  state.indexProblems = iProblems;
  saveState(state);
  const index = indexOf(files);
  fs.writeFileSync(path.join(dir, "index-after-recording.md"), index.endsWith("\n") ? index : `${index}\n`);
  const indexLines = index.trimEnd().split("\n").filter((l) => l.trim() !== "");
  const summary = {
    status: STATUS,
    model: RECORDER_MODEL,
    nameCheck: nameCheckLabel(names.length, runs.reduce((n, r) => n + ((r.nameHitsAfterReadBack as unknown[] | null)?.length ?? 0), 0)),
    files: files.map((f) => f.path),
    indexIdentical: iProblems.length === 0,
    indexRewrittenByApp,
    indexLines: indexLines.length,
    runs,
  };
  saveJson(runFile, summary);
  console.table(runs.map((r) => ({ id: r.id, ms: r.ms, 同じ文で書けた: r.agentWroteIdentical, 索引に行: r.indexHasLine, 止まり方: r.stopReason, 確かめた: r.verified })));
  if (iProblems.length > 0) throw new Error(`索引が渡した行と合わない（${iProblems.join("、")}）。夢へ進めない`);
  log(`記録 終わり。ストアのファイル：${summary.files.join("、")}。${summary.nameCheck === "未検査（名前の一覧を渡していない）" ? "名前の検査は未検査。" : ""}`);
}

/** ストアを読むだけで、前に渡した記録が残っているかを確かめる（書き換えない）。結果は store-check.json と --state に残す */
async function commandVerifyStore(): Promise<void> {
  const names = namesFromFile();
  const client = getClient();
  const state = loadState();
  assertSameRecordFormat(state);
  const dir = runDirOf(state);
  if (!state.resources || !state.sessions) throw new Error("記録がまだ無い。先に record を回す");
  const files = await readStore(client, state.resources.storeId);
  const index = indexOf(files);
  const rows = PLAN.map((p) => {
    const localFile = path.join(dir, "records", `${p.date}-${p.id}.md`);
    const expected = fs.existsSync(localFile) ? fs.readFileSync(localFile, "utf8") : null;
    const entry = state.sessions?.[p.id];
    if (expected === null) return { id: p.id, problems: ["手元に渡した文が無い"], sessionKnown: !!entry, identical: false };
    const stored = checkStoredRecord(files, p.id, p.date, expected, names);
    // 索引の行の文は記録の形の版で違うので、ここでは記録を指す行があるかを見る。全体は下で、控えた索引と比べる
    const indexHasLine = index.split("\n").some((l) => l.startsWith(`- ${recordPath(p.id, p.date).slice(1)}｜`));
    const problems = [...storedProblems(stored, indexHasLine), ...(entry ? [] : ["セッションが無い"])];
    if (entry) (state.sessions as Record<string, SessionEntry>)[p.id] = { ...entry, verified: problems.length === 0, problems };
    return { id: p.id, problems, sessionKnown: !!entry, identical: stored.identical, traitHits: stored.check?.traitHits.length ?? null, scoreHits: stored.check?.scoreHits.length ?? null, nameCheck: nameCheckLabel(names.length, stored.check?.nameHits.length ?? 0) };
  });
  const indexFile = path.join(dir, "index-after-recording.md");
  const savedIndex = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf8") : null;
  const iProblems = savedIndex === null ? ["手元に控えた索引が無い"] : savedIndex.trimEnd() === index.trimEnd() ? [] : ["控えた索引と違う"];
  state.indexVerified = iProblems.length === 0;
  state.indexProblems = iProblems;
  saveState(state);
  const ok = rows.every((r) => r.problems.length === 0) && iProblems.length === 0;
  saveJson(path.join(dir, "store-check.json"), { status: STATUS, checkedAt: new Date().toISOString(), what: "メモリストアを読み、手元に控えた記録・索引と比べた（書き換えていない）", ok, files: files.map((f) => f.path), records: rows, indexProblems: iProblems });
  console.table(rows.map((r) => ({ id: r.id, 同じ: r.identical, 性質の言葉: r.traitHits, 点と判定: r.scoreHits, 名前: r.nameCheck, 問題: r.problems.join("、") })));
  log(`ストアの確かめ 終わり：${ok ? "すべて合った" : "合わない所がある"}（索引：${iProblems.join("、") || "合った"}）`);
  if (!ok) throw new Error("ストアが手元の控えと合わない。夢へ進めない");
}

/** 本人の訂正を、ストアの記録と手元の控えに当てる。夢に渡すセッションから、この面談を外す印を残す */
async function commandCorrect(): Promise<void> {
  const interviewId = option("--interview");
  const oldText = option("--old");
  const newText = option("--new");
  if (!interviewId || !oldText || !newText) throw new Error("--interview <面談> --old <直す文> --new <直した文> を付けてください");
  const names = namesFromFile();
  const client = getClient();
  const state = loadState();
  assertSameRecordFormat(state);
  const dir = runDirOf(state);
  if (!state.resources || !state.sessions?.[interviewId]) throw new Error(`${interviewId} の記録がまだ無い`);
  const plan = PLAN.find((p) => p.id === interviewId);
  if (!plan) throw new Error(`${interviewId} はサンプルの面談に無い`);
  const before = await readStore(client, state.resources.storeId);
  const file = before.find((f) => f.path === recordPath(interviewId, plan.date));
  if (!file) throw new Error(`${interviewId} の記録のファイルが無い`);
  const next = applyCorrection(file.content, { oldText, newText });
  await client.beta.memoryStores.memories.update(file.id, { memory_store_id: state.resources.storeId, content: next });
  const after = await readStore(client, state.resources.storeId);
  const stored = checkStoredRecord(after, interviewId, plan.date, next, names);
  const problems = storedProblems(stored, indexOf(after).split("\n").some((l) => l.startsWith(`- ${recordPath(interviewId, plan.date).slice(1)}｜`)));
  state.sessions[interviewId] = { ...state.sessions[interviewId], verified: problems.length === 0, problems };
  if (problems.length === 0) {
    fs.writeFileSync(path.join(dir, "records", `${plan.date}-${interviewId}.md`), next);
    (state.corrections ??= []).push({ interviewId, date: plan.date, oldText, newText });
  }
  saveState(state);
  if (problems.length > 0) throw new Error(`${interviewId}：直したあとの検査に通らない（${problems.join("、")}）`);
  log(`${interviewId}：本人の訂正を当てた。夢には、この面談のセッションを渡さない`);
}

const BANNER = `> 暫定：サンプルの記録（作ったダミーの面談 ${PLAN.length} 回）から夢が作った出力。本人は確かめていない。確かめた分析として扱わない。`;

async function commandDream(): Promise<void> {
  const cap = Number(option("--cap"));
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--cap <入力トークン換算の上限> を付けてください");
  const client = getClient();
  const state = loadState();
  assertSameRecordFormat(state);
  const dir = runDirOf(state);
  if (!state.resources || !state.sessions) throw new Error("記録がまだ無い。先に record を回す");
  if (state.scoresStoreId === state.resources.storeId) throw new Error("記録のストアと点の控えのストアが同じ。夢に点が届くので止める（決まり 10）");
  if (state.dream && !flag("--again")) throw new Error(`夢はすでに回した（${state.dream.dreamId}）。回し直すなら --again`);
  // 開始条件：全部の面談の保存を確かめてあること。ID がそろっているだけでは始めない
  const planIds = PLAN.map((p) => p.id);
  const blockers = dreamBlockers(planIds, state.sessions, state.indexVerified === true);
  if (blockers.length > 0) throw new Error(`保存を確かめていないので、夢を始めない：\n- ${blockers.join("\n- ")}\nrecord か record --verify-only を回す`);
  const corrections = state.corrections ?? [];
  const { sessionIds, excluded } = sessionIdsForDream(planIds, state.sessions, corrections.map((c) => c.interviewId));
  if (excluded.length > 0) log(`本人が直した記録のセッションは渡さない：${excluded.join("、")}`);
  if (state.dream && flag("--again") && fs.existsSync(path.join(dir, "dream"))) {
    // 前の回の出力を残す
    const keep = path.join(dir, `dream-before-${stamp()}`);
    fs.mkdirSync(keep, { recursive: true });
    fs.renameSync(path.join(dir, "dream"), path.join(keep, "dream"));
    for (const name of ["dream-run.json", "dream-instructions.md", "evidence.json", "evidence.md"]) if (fs.existsSync(path.join(dir, name))) fs.renameSync(path.join(dir, name), path.join(keep, name));
  }
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
    stoppedBy: run.stoppedBy,
    cancelRequested: run.cancelRequested,
    cancelError: run.cancelError,
    monitorErrors: run.monitorErrors,
    lastMonitorError: run.lastMonitorError,
    watchEndedBeforeTerminal: run.watchEndedBeforeTerminal,
    overCapBy: Math.max(0, run.inputEquivalent - run.capInputEquivalent),
    capIsStrict: false,
    error: run.error,
    samples: run.samples,
    instructionsChars: [...instructions].length,
    sessions: sessionIds.length,
    sessionsExcludedForCorrection: excluded,
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
    if (corrections.length > 0) out.correctionCheck = checkCorrectionKept(files, corrections);
  }
  fs.writeFileSync(path.join(dir, "dream-instructions.md"), `> この回の夢に渡した指示（engine/recorder.mts の dreamInstructions）。\n\n${instructions}\n`);
  saveJson(path.join(dir, "dream-run.json"), out);
  log(`夢 終わり：${run.status}、${run.ms} ms、入力トークン換算 ${run.inputEquivalent}（上限 ${cap}）`);
  console.log(JSON.stringify({ usage: tokensOf(run.usage), files: out.outputFiles, recordsUnchanged: out.recordsUnchanged, correctionCheck: out.correctionCheck }, null, 2));
  if (run.watchEndedBeforeTerminal) throw new Error(`夢が終わったのを確かめないまま見張りをやめた（${run.stoppedBy}）。まだ動いているかもしれない。コンソールで確かめる`);
  if (run.status !== "completed") throw new Error(`夢が完了しなかった（${run.status}）`);
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

function listHits(perFile: Record<string, unknown>[], key: string): string {
  const parts = perFile.flatMap((f) => (f[key] as TextHit[]).map((h) => `${f.file} ${h.line} 行目「${h.word}」`));
  return parts.length > 0 ? parts.join("、") : "なし";
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
    perFile.push({ file: name, chars: [...md].length, evidence: summarizeEvidence(checks), traitHits: trait.traitHits, scoreHits: trait.scoreHits, growthHits: growthHits(md), causalHits: causalHits(md), verificationClaims: verificationClaims(md), provisionalOnFirstLine: /暫定/.test(md.split("\n").filter((l) => l.trim() !== "" && !l.startsWith(">"))[0] ?? "") });
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
      counterOverlaps: counterOverlaps(h),
    };
  });
  const result = {
    status: STATUS,
    files: perFile,
    evidence: summarizeEvidence(allChecks),
    uniqueUtterances: uniqueUtterances(allChecks),
    hypotheses: summarizeHypotheses(hypotheses),
    hypothesisRows,
    checks: allChecks,
  };
  saveJson(path.join(dir, "evidence.json"), result);
  const cell = (s: string) => s.replace(/\|/g, "｜").replace(/\n/g, " ");
  const md = `# 夢の出力の根拠と、発話の原文の照合（${state.runId}）

${BANNER.replace("夢が作った出力", "夢の出力を、プログラムで原文と照合した結果")}

照合で分かるのは「その面談のその番号の発話に、その言葉がある」ことまで。その発話が仮説を支えるかは、この表では分からない。根拠の数は、独立した証拠の数ではない（同じ発話を別の仮説でも挙げている）。

## 数

- 根拠の数：${result.evidence.total}（引用つき ${result.evidence.withQuote}）。重なりを除くと ${result.uniqueUtterances} 発話
- 番号も言葉も原文と合った：${result.evidence.matched}
- 内訳：${Object.entries(result.evidence.byStatus).map(([k, v]) => `${k} ${v}`).join("、")}
- 話者が違った：${result.evidence.speakerMismatch}
- 仮説：${result.hypotheses.total}（根拠が 2 回以上の面談にまたがる ${result.hypotheses.acrossInterviews}、反例を発話つきで挙げた ${result.hypotheses.withCounterEvidence}、反例の欄が文だけ ${result.hypotheses.withCounterNoteOnly}、反例の欄が空 ${result.hypotheses.withoutCounter}）
- 確からしさ（夢自身の見立て。測った数字ではなく、引用の一致とは別のもの）：${Object.entries(result.hypotheses.byConfidence).map(([k, v]) => `${k} ${v}`).join("、")}

## 確かめが要る所（プログラムで見つけた候補。当たらなくても、問題が無いとは限らない）

- 根拠と反例の両方に挙げた発話：${hypothesisRows.filter((h) => h.counterOverlaps.length > 0).map((h) => `${h.id}（${h.counterOverlaps.join("、")}）`).join("／") || "なし"}
- 原因を言い切る言い方の候補：${listHits(perFile, "causalHits")}
- 夢が「照合した」と自分で書いた所（照合したのはアプリ）：${listHits(perFile, "verificationClaims")}

## ファイルごと

| ファイル | 字数 | 根拠 | 合った | 性質の言葉 | 点と判定の言葉 | 変化を言い切る言葉 | 1 行目に暫定 |
|---|---|---|---|---|---|---|---|
${perFile.map((f) => `| ${f.file} | ${f.chars} | ${(f.evidence as { total: number }).total} | ${(f.evidence as { matched: number }).matched} | ${(f.traitHits as unknown[]).length} | ${(f.scoreHits as unknown[]).length} | ${(f.growthHits as unknown[]).length} | ${f.provisionalOnFirstLine ? "あり" : "なし"} |`).join("\n")}

## 仮説ごと

| 仮説 | 確からしさ（夢の見立て） | 根拠の面談 | 根拠（合った／数） | 反例（合った／数） | 反例の欄の文 |
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
  console.log(JSON.stringify({ evidence: result.evidence, hypotheses: result.hypotheses, files: perFile.map((f) => ({ file: f.file, trait: (f.traitHits as unknown[]).length, score: (f.scoreHits as unknown[]).length, growth: (f.growthHits as unknown[]).length })) }, null, 2));
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
  const analysisNote = "今回回した呼び出しだけ。同時に回したので、時間は呼び出しごとの合計";
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
  const rec = loadJson<{ model: string; indexIdentical: boolean; nameCheck?: string; runs: { id: string; ms: number; usage: Omit<CallMeta, "model" | "ms">; agentWroteIdentical: boolean; fixedByApp: boolean; errors: string[]; indexHasLine: boolean; toolUses: Record<string, number>; traitHitsAfterReadBack: unknown[] | null; nameHitsAfterReadBack: unknown[] | null }[] }>(path.join(dir, "record-run.json"));
  if (rec) {
    const row = empty(`記録係（セッション ${rec.runs.length} 本。1 本ずつ順番に）`, rec.model, "時間はセッションを作ってから止まるまで");
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
    recorderTraitHitsAfterReadBack: rec ? rec.runs.filter((r) => (r.traitHitsAfterReadBack?.length ?? 0) > 0).map((r) => r.id) : [],
    recorderNameCheck: rec?.nameCheck ?? nameCheckLabel(0, 0),
    dreamCanceled: dream ? dream.canceledByCap || dream.dreamStatus !== "completed" : null,
    dreamError: dream?.error ?? null,
    dreamChangedRecords: dream?.recordsUnchanged ? dream.recordsUnchanged.filter((r) => !r.unchanged).map((r) => r.path) : null,
  };
  const summary = { status: STATUS, runId: state.runId, interviews: perInterview, steps: rows, recorder: rec ? { indexIdentical: rec.indexIdentical, runs: rec.runs.map((r) => ({ id: r.id, ms: r.ms, usage: r.usage, toolUses: r.toolUses, agentWroteIdentical: r.agentWroteIdentical, indexHasLine: r.indexHasLine })) } : null, dream, evidence: evidence ? { evidence: evidence.evidence, hypotheses: evidence.hypotheses, traitHits: evidence.files.reduce((n, f) => n + f.traitHits.length, 0), growthHits: evidence.files.reduce((n, f) => n + f.growthHits.length, 0) } : null, failures };
  saveJson(path.join(dir, "summary.json"), summary);
  const sec = (ms: number) => (ms / 1000).toFixed(1);
  const md = `# 時間・トークン数・失敗とやり直し（${state.runId}）

> 暫定：作ったダミーの面談 ${PLAN.length} 回で回した記録係と夢の数字。金額は書かない（トークン数と時間だけ）。

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

- 索引は、渡した ${PLAN.length} 行と見出しだけか：${rec?.indexIdentical ? "はい" : "いいえ"}

## 失敗とやり直し

- 分析のやり直し：${failures.analysisRetries.length} 件${failures.analysisRetries.length > 0 ? `（${failures.analysisRetries.join("／")}）` : ""}
- 記録係のセッションのエラー：${failures.recorderErrors.length} 件
- 記録係が渡した文と違う文を書き、アプリが書き直した：${failures.recorderRewrittenByApp.length} 件
- 読み返しで、性質の言葉が見つかった記録：${failures.recorderTraitHitsAfterReadBack.length} 件（AI が書いた文を、言葉の一覧と照らした。発話の本文は数えない）
- 名前の検査：${failures.recorderNameCheck}
- 夢の上限：入力トークン換算で見張り、超えたら取り消す作り。見るのは定期的なので、厳密な上限ではない
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
  else if (command === "record") await (flag("--verify-only") ? commandVerifyStore() : commandRecord());
  else if (command === "scores") await commandScores();
  else if (command === "correct") await commandCorrect();
  else if (command === "dream") await commandDream();
  else if (command === "verify") commandVerify();
  else throw new Error("使い方：node scripts/memory/run.mts analyze | record | scores | dream | correct | verify | summary");
} catch (e) {
  console.error(`止まりました：${(e as Error).message}`);
  process.exit(1);
}

