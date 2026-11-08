// 記録の読み出し（docs/設計書.md 画面 3・画面 5、「覚えていると整理」）。サーバー側からだけ使う。
// 公開 URL は読むだけで、書かない。ここに書く処理を足さない。
// - 記録の一覧：記録（①）と点の控え（②）を読み、日付順に並べて返す。AI は呼ばない。
// - 前の言葉：夢の「繰り返す場面」から工程 3 に渡す文を作り、工程 3 が返した札から、記録の原文を引く。AI が書いた引用文は出さない（決まり 1）。
// 夢が書いた文（仮説など）は画面に出さない。点と判定は工程 3 に渡さない（決まり 10）。

import type Anthropic from "@anthropic-ai/sdk";

import { scanText } from "./forbidden-words.mts";
import { parseEvidenceRefs, parseHypotheses } from "./memory-evidence.mts";
import type { EvidenceRef } from "./memory-evidence.mts";
import { ACTION_HEADING, FOLLOW_UP_HEADING, ORIGINAL_HEADING, RECORD_FORMAT, scanScoreWords } from "./memory-record.mts";
import type { RecordLine } from "./memory-record.mts";
import { DREAM_FILES, readStore } from "./recorder.mts";
import type { StoredFile } from "./recorder.mts";
import { ledgerTotal, parseLedgerEntry } from "./score-ledger.mts";
import type { LedgerEntry } from "./score-ledger.mts";
import { SPEAKER_LABELS } from "./types.mts";
import type { MeetingKind, PreviousWords, SceneType } from "./types.mts";

/** ストアの番号の環境変数。これが旗で、無ければ画面 3 は今のまま、記録の入口は出さない */
export const MEMORY_ENV = {
  records: "REFLECTIONSPARK_MEMORY_RECORDS_STORE",
  dream: "REFLECTIONSPARK_MEMORY_DREAM_STORE",
  scores: "REFLECTIONSPARK_MEMORY_SCORES_STORE",
} as const;

export type MemoryConfig = { recordsStoreId: string; dreamStoreId: string | null; scoresStoreId: string | null };

export function memoryConfig(env: Record<string, string | undefined> = process.env): MemoryConfig | null {
  const recordsStoreId = env[MEMORY_ENV.records]?.trim();
  if (!recordsStoreId) return null;
  return { recordsStoreId, dreamStoreId: env[MEMORY_ENV.dream]?.trim() || null, scoresStoreId: env[MEMORY_ENV.scores]?.trim() || null };
}

// ---------- 記録の文を読む ----------

export type RecordSceneLines = { type: SceneType; quotes: RecordLine[]; neighbors: RecordLine[] };

export type ParsedRecord = {
  interviewId: string;
  date: string;
  kind: MeetingKind;
  order: number;
  otherTag: string | null;
  followsInterviewId: string | null;
  scenes: RecordSceneLines[];
  followUp: { previousInterviewId: string | null; previousAction: string; criterion: string | null; origin: string; quotes: RecordLine[]; neighbors: RecordLine[] } | null;
  action: { sentence: string; criterion: string | null; origin: string } | null;
};

const QUOTE_LINE = /^> 〔発話 (\d+)〕([^：]+)：(.*)$/u;
const SCENE_HEADING = /^### 場面 \d+：(.+)$/u;
const NONE = /^（.*）$/u;
const orNull = (s: string): string | null => (s === "" || NONE.test(s) ? null : s);

function frontmatter(lines: string[]): Record<string, string> | null {
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  const out: Record<string, string> = {};
  for (const l of lines.slice(1, end)) {
    const at = l.indexOf(": ");
    if (at > 0) out[l.slice(0, at)] = l.slice(at + 2).trim();
  }
  return out;
}

/**
 * 記録の文（engine/memory-record.mts の renderRecord）を読む。形が違えば null（画面に出さない）。
 * 発話の本文は「>」の行からだけ取る。AI が書いた説明と読みの欄は読まない。
 */
export function parseRecord(markdown: string): ParsedRecord | null {
  const lines = markdown.split("\n");
  const fm = frontmatter(lines);
  if (!fm || fm.interview === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(fm.date ?? "") || Number(fm.record_format) !== RECORD_FORMAT) return null;
  const record: ParsedRecord = {
    interviewId: fm.interview,
    date: fm.date,
    kind: fm.kind as MeetingKind,
    order: Number(fm.order),
    otherTag: orNull(fm.other ?? ""),
    followsInterviewId: orNull(fm.follows ?? ""),
    scenes: [],
    followUp: null,
    action: null,
  };
  if (!(record.kind in SPEAKER_LABELS)) return null;
  let section: "original" | "action" | "other" = "other";
  let target: { quotes: RecordLine[]; neighbors: RecordLine[] } | null = null;
  let bucket: "quotes" | "neighbors" = "quotes";
  let actionPart: "previous" | "current" | null = null;
  const prev = { previousInterviewId: null as string | null, previousAction: "", criterion: null as string | null, origin: "" };
  const cur = { sentence: "", criterion: null as string | null, origin: "" };
  for (const l of lines) {
    if (l.startsWith("## ")) {
      section = l === ORIGINAL_HEADING ? "original" : l === ACTION_HEADING ? "action" : "other";
      target = null;
      actionPart = null;
      continue;
    }
    if (section === "original") {
      const sc = SCENE_HEADING.exec(l);
      if (sc) {
        const scene: RecordSceneLines = { type: sc[1] as SceneType, quotes: [], neighbors: [] };
        record.scenes.push(scene);
        target = scene;
        bucket = "quotes";
        continue;
      }
      if (l === FOLLOW_UP_HEADING) {
        record.followUp = { ...prev, quotes: [], neighbors: [] };
        target = record.followUp;
        bucket = "quotes";
        continue;
      }
      if (l.startsWith("- 前後の発話")) bucket = "neighbors";
      else if (l.startsWith("- 引用") || l.startsWith("- この回に現れた発言")) bucket = "quotes";
      const q = QUOTE_LINE.exec(l);
      if (q && target) target[bucket].push({ index: Number(q[1]), speaker: q[2], text: q[3] });
      continue;
    }
    if (section === "action") {
      if (l === "### 前回の行動") actionPart = "previous";
      else if (l === "### この回に決めた行動") actionPart = "current";
      const value = (label: string) => (l.startsWith(`- ${label}：`) ? l.slice(label.length + 3).trim() : null);
      if (actionPart === "previous") {
        prev.previousInterviewId = orNull(value("前回の面談") ?? prev.previousInterviewId ?? "");
        prev.previousAction = value("行動") ?? prev.previousAction;
        prev.criterion = orNull(value("できたかの基準") ?? prev.criterion ?? "");
        prev.origin = value("決まり方") ?? prev.origin;
      } else if (actionPart === "current") {
        cur.sentence = value("行動") ?? cur.sentence;
        cur.criterion = orNull(value("できたかの基準") ?? cur.criterion ?? "");
        cur.origin = value("決まり方") ?? cur.origin;
      }
    }
  }
  if (record.followUp) Object.assign(record.followUp, prev);
  if (cur.sentence !== "" && !cur.sentence.startsWith("なし")) record.action = { ...cur };
  return record;
}

const isRecordFile = (f: StoredFile) => f.path.startsWith("/records/") && f.path.endsWith(".md");

export function parseRecords(files: StoredFile[]): ParsedRecord[] {
  return files.filter(isRecordFile).flatMap((f) => parseRecord(f.content) ?? []);
}

// ---------- 記録の一覧（画面 5） ----------

export type RecordEntry = {
  interviewId: string;
  date: string;
  kind: MeetingKind;
  otherTag: string | null;
  /** 同じ相手との何回目か（1 始まり） */
  meetingWithOther: number;
  /** よく表れた所 */
  strength: { quotes: RecordLine[]; neighbors: RecordLine[] } | null;
  /** 次に試せる所 */
  nextTry: { quotes: RecordLine[]; neighbors: RecordLine[] } | null;
  /** 選んだひとつ */
  action: { sentence: string; criterion: string | null; origin: string } | null;
  /** 前回のひとつと今回の発言（続きの回だけ） */
  followUp: { previousInterviewId: string | null; previousAction: string; quotes: RecordLine[]; neighbors: RecordLine[] } | null;
  /** 点（無ければ null）。引用の後ろに置く */
  scores: {
    selfScore: number;
    selfNote: string;
    selfVerdict: LedgerEntry["selfVerdict"];
    aiItems: LedgerEntry["aiItems"];
    aiTotal: ReturnType<typeof ledgerTotal>;
    aiVerdict: LedgerEntry["aiVerdict"];
  } | null;
};

const sceneOf = (r: ParsedRecord, type: SceneType) => {
  const s = r.scenes.find((x) => x.type === type);
  return s ? { quotes: s.quotes, neighbors: s.neighbors } : null;
};

/** 記録と点の控えを、面談の日付の古い順に並べる。メモリの並びと、書いた日時は使わない */
export function buildRecordList(recordFiles: StoredFile[], scoreFiles: StoredFile[]): RecordEntry[] {
  const ledger = new Map<string, LedgerEntry>();
  for (const f of scoreFiles) {
    const e = parseLedgerEntry(f.content);
    if (e) ledger.set(`${e.date}/${e.interviewId}`, e);
  }
  const records = parseRecords(recordFiles).sort((a, b) => a.date.localeCompare(b.date) || a.interviewId.localeCompare(b.interviewId));
  const seen = new Map<string, number>();
  return records.map((r) => {
    const tag = r.otherTag ?? "";
    const meetingWithOther = (seen.get(tag) ?? 0) + 1;
    seen.set(tag, meetingWithOther);
    const e = ledger.get(`${r.date}/${r.interviewId}`) ?? null;
    return {
      interviewId: r.interviewId,
      date: r.date,
      kind: r.kind,
      otherTag: r.otherTag,
      meetingWithOther,
      strength: sceneOf(r, "よく表れた所"),
      nextTry: sceneOf(r, "次に試せる所"),
      action: r.action,
      followUp: r.followUp ? { previousInterviewId: r.followUp.previousInterviewId, previousAction: r.followUp.previousAction, quotes: r.followUp.quotes, neighbors: r.followUp.neighbors } : null,
      scores: e ? { selfScore: e.selfScore, selfNote: e.selfNote, selfVerdict: e.selfVerdict, aiItems: e.aiItems, aiTotal: ledgerTotal(e), aiVerdict: e.aiVerdict } : null,
    };
  });
}

/** 記録の一覧を読む。点の控えが読めないときは、点を空にして返す（記録の画面は引用と行動で成り立つ） */
export async function readRecordList(client: Anthropic, cfg: MemoryConfig): Promise<RecordEntry[]> {
  const recordFiles = await readStore(client, cfg.recordsStoreId);
  let scoreFiles: StoredFile[] = [];
  if (cfg.scoresStoreId) {
    try {
      scoreFiles = await readStore(client, cfg.scoresStoreId);
    } catch {
      scoreFiles = [];
    }
  }
  return buildRecordList(recordFiles, scoreFiles);
}

// ---------- 前の言葉（画面 3） ----------

const evidenceLine = (e: EvidenceRef) => `〔${e.interviewId}｜発話 ${e.index === e.lastIndex ? e.index : `${e.index}〜${e.lastIndex}`}〕${e.speaker ?? ""}：「${e.quote ?? ""}」`;

/**
 * 夢の「繰り返す場面」から、工程 3 に渡す文を作る。仮説の文、場面の形、根拠の行、例外・反例の行だけ。
 * 確からしさ（夢の見立て）と説明の文は渡さない。
 * 仮説が読めないとき、点や判定の言葉か性質の言葉が入っているときは null（渡さない。決まり 3・10）。
 */
export function pastScenesText(recurringMarkdown: string): string | null {
  const hypotheses = parseHypotheses(recurringMarkdown).filter((h) => h.evidence.length > 0);
  if (hypotheses.length === 0) return null;
  const text = hypotheses
    .map((h) => {
      const out = [`## ${h.id}：${h.statement}`];
      if (h.sceneShape) out.push(`- 場面の形：${h.sceneShape}`);
      out.push("- 根拠：", ...h.evidence.map((e) => `  - ${evidenceLine(e)}`));
      if (h.counter.length > 0) out.push("- 例外・反例：", ...h.counter.map((e) => `  - ${evidenceLine(e)}`));
      return out.join("\n");
    })
    .join("\n\n");
  if (scanScoreWords(text, "繰り返す場面").length > 0 || scanText(text, "繰り返す場面").length > 0) return null;
  return text;
}

/** 工程 3 が返した札（「student-a｜発話 12」など）を読む。読めなければ null */
export function parsePreviousRef(ref: string | null | undefined): { interviewId: string; index: number } | null {
  const t = (ref ?? "").trim();
  if (t === "") return null;
  const refs = parseEvidenceRefs(t.startsWith("〔") ? t : `〔${t}〕`);
  if (refs.length !== 1 || refs[0].index !== refs[0].lastIndex) return null;
  return { interviewId: refs[0].interviewId, index: refs[0].index };
}

/**
 * 札から、記録の原文を引く（決まり 1）。札が記録に無いとき、本人の発話でないときは null（出さない）。
 * 前後の発話は、記録にあるものだけ。夢の文も、AI が書いた引用文も使わない。
 */
export function resolvePreviousWords(ref: string | null | undefined, records: ParsedRecord[]): PreviousWords | null {
  const parsed = parsePreviousRef(ref);
  if (!parsed) return null;
  const record = records.find((r) => r.interviewId === parsed.interviewId);
  if (!record) return null;
  const lines = new Map<number, RecordLine>();
  for (const part of [...record.scenes, ...(record.followUp ? [record.followUp] : [])]) for (const l of [...part.quotes, ...part.neighbors]) lines.set(l.index, l);
  const own = lines.get(parsed.index);
  if (!own || own.speaker !== SPEAKER_LABELS[record.kind].self) return null;
  return {
    date: record.date,
    otherTag: record.otherTag,
    before: lines.get(parsed.index - 1) ?? null,
    own,
    after: lines.get(parsed.index + 1) ?? null,
    interviewId: record.interviewId,
    utterance: parsed.index,
  };
}

export type Step3Memory = { pastScenes: string; records: ParsedRecord[] };

/** 工程 3 に渡す材料を読む。夢の出力か記録が読めなければ null（工程 3 は今のまま） */
export async function readStep3Memory(client: Anthropic, cfg: MemoryConfig): Promise<Step3Memory | null> {
  if (!cfg.dreamStoreId) return null;
  const [dreamFiles, recordFiles] = await Promise.all([readStore(client, cfg.dreamStoreId), readStore(client, cfg.recordsStoreId)]);
  const recurring = dreamFiles.find((f) => f.path === DREAM_FILES.recurring)?.content;
  if (!recurring) return null;
  const pastScenes = pastScenesText(recurring);
  const records = parseRecords(recordFiles);
  if (!pastScenes || records.length === 0) return null;
  return { pastScenes, records };
}

/** 読み出しに時間の上限を付ける（画面 3 と記録の画面を、読み出しで長く止めない） */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("読み出しの時間切れ")), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}
