// 記録係に渡す「事実の記録」を作る（docs/設計書.md 工程 5 と「覚えていると整理」、決まり 3・10・12）。
// ここは純粋な関数だけ。Managed Agents の呼び出しは engine/recorder.mts。
//
// 記録の形：1 回の面談につき 1 ファイル。面談の日付と、場面と行動だけ。回をまたいだ変化は書かない（夢で出す）。
// 出所ごとに見出しを分ける（AI の文を事実として残さない）：
// - 「原文」：照合済みの引用と、アプリが発話番号から取った前後の発話。発話の本文そのまま。
// - 「行動」：決めた行動と前回の行動。どう決まったか（本人が選んだ／サンプルとして置いた）を添える。
// - 「AI が書いた説明」：文脈・観察・直後の反応。原文と照合していない。
// - 「その回の AI の読み（仮説）」：読み、意図した選択として見たとき。外せる（includeAiReading）。
// 渡さないもの：本人の自己採点・自己評価・一言、AI の点と判定と判定のなぜ（点の控えに、engine/score-ledger.mts）、文字起こしの全文。
// 相手の名前と、人物の性質の言葉は書かない。夢は記録と記録係のセッションを読むので、ここに点と判定を入れると次の回の AI に届く（決まり 10）。

import { quoteMatchesTranscript } from "./citations.mts";
import { scanText } from "./forbidden-words.mts";
import type { ForbiddenHit } from "./forbidden-words.mts";
import { WITHHELD_NOTICE } from "./guard.mts";
import type { MeetingKind, Quote, Scene, SceneType, Utterance } from "./types.mts";
import { blockLabel, utteranceLabel } from "./utterance-no.mts";

/** 記録に書く 1 発話（本文は発話の本文そのまま） */
export type RecordLine = { index: number; speaker: string; text: string };

export type RecordScene = {
  type: SceneType;
  /** 文脈の一行（事実だけ） */
  context: string;
  /** 照合済みの引用（発話ごとに 1 行） */
  quotes: RecordLine[];
  /** 引用の直前・直後の発話（アプリが発話番号から取る。引用と重なるものは入れない） */
  neighbors: RecordLine[];
  /** AI が書いた観察と、直後の相手の反応（原文との照合はしていない） */
  observation: string;
  reaction: string;
};

export type RecordAction = {
  /** 「もし（場面）なら、（行動）する」 */
  sentence: string;
  criterion: string | null;
  /** どう決まったか（本人が選んだ／直した、検証用に置いた、など） */
  origin: string;
};

export type RecordFollowUp = {
  previousInterviewId: string | null;
  previousAction: string;
  /** 前回の行動がどう決まったか（本人が選んだ／直した、検証用に置いた、など） */
  previousActionOrigin: string;
  criterion: string | null;
  /** 次の回に現れた発言の引用。判定は入れない（決まり 10） */
  quotes: RecordLine[];
  neighbors: RecordLine[];
};

export type RecordAiReading = {
  scenes: { type: SceneType; reading: string; asChoice: string | null }[];
  otherPersonLine: string | null;
};

export type FactRecord = {
  interviewId: string;
  /** 面談の日付（YYYY-MM-DD）。メモリに付く日時は書いた日時なので、頭の欄とファイル名に入れる */
  date: string;
  kind: MeetingKind;
  /** この人の記録の中で何本目か（1 始まり） */
  order: number;
  /** 相手の札（記録を相手ごとにつなぐ札。名前ではない） */
  otherTag: string | null;
  /** 続きの面談のとき、前の面談の ID */
  followsInterviewId: string | null;
  /** 「検証用・暫定」など、この記録の確かめの状態 */
  status: string;
  utteranceCount: number;
  scenes: RecordScene[];
  noScene: string | null;
  action: RecordAction | null;
  followUp: RecordFollowUp | null;
  aiReading: RecordAiReading;
  /** 記録に入れなかったもの（数と欄の名前） */
  dropped: { unverifiedQuotes: number; withheldFields: string[] };
};

export type FactRecordInput = {
  interviewId: string;
  date: string;
  kind: MeetingKind;
  order: number;
  otherTag: string | null;
  followsInterviewId: string | null;
  status: string;
  /** 整形後の発話の並び。引用の確かめ直しと、前後の発話を取るためだけに使う。記録には全文を書かない */
  utterances: Utterance[];
  step1: { scenes: Scene[]; noScene: string | null } | null;
  chosenAction: RecordAction | null;
  followUp: {
    previousInterviewId: string | null;
    previousAction: string;
    previousActionOrigin: string;
    criterion: string | null;
    /** 工程 4 の引用（次の回に現れた発言）。判定・なぜ・点は渡さない */
    quotes: Quote[];
    otherPersonLine: string | null;
  } | null;
};

/** 面談 ID に使える文字（メモリのパスと、夢の根拠の書き方に使うので、英数字とハイフンだけ） */
const INTERVIEW_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** 面談の日付の形 */
const INTERVIEW_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 記録係に渡してはいけない欄の名前（本人の自己採点・自己評価・一言、AI の点と判定と判定のなぜ。決まり 10 と工程 5 の「渡さない」） */
const SELF_KEYS = /^(self|demoSelf)|自己|本人の(点|一言|評価)|^(verdict|score|scores|total|why|step2|step4)$/i;

/** 入力に、本人の自己採点・自己評価、AI の点と判定らしい欄が紛れていないかを確かめる。あれば投げる */
export function assertNoSelfEvaluation(input: unknown, path = "input"): void {
  if (Array.isArray(input)) {
    input.forEach((v, i) => assertNoSelfEvaluation(v, `${path}[${i}]`));
    return;
  }
  if (!input || typeof input !== "object") return;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SELF_KEYS.test(k)) throw new Error(`記録係に渡せない欄があります：${path}.${k}（自己採点・自己評価と、AI の点・判定は記録に入れない）`);
    assertNoSelfEvaluation(v, `${path}.${k}`);
  }
}

function lineOf(utterances: Utterance[], index: number): RecordLine | null {
  const u = utterances[index];
  if (!u || u.text === null) return null;
  return { index, speaker: u.speaker, text: u.text };
}

/** 照合済みで、今の発話の本文とも一致する引用だけを、発話ごとの行にする。合わない引用は数える */
function quoteLines(quotes: Quote[], utterances: Utterance[]): { lines: RecordLine[]; droppedCount: number } {
  const lines = new Map<number, RecordLine>();
  let droppedCount = 0;
  for (const q of quotes) {
    if (!quoteMatchesTranscript(q, utterances)) {
      droppedCount++;
      continue;
    }
    for (let i = q.index; i < q.endIndex; i++) {
      const l = lineOf(utterances, i);
      if (l) lines.set(i, l);
    }
  }
  return { lines: [...lines.values()].sort((a, b) => a.index - b.index), droppedCount };
}

/** 引用の直前・直後の発話（引用と重ならないもの）。AI に書かせず、発話番号から取る（決まり 1） */
function neighborLines(quoted: RecordLine[], utterances: Utterance[]): RecordLine[] {
  const cited = new Set(quoted.map((l) => l.index));
  const out = new Map<number, RecordLine>();
  for (const l of quoted) {
    for (const i of [l.index - 1, l.index + 1]) {
      if (cited.has(i) || out.has(i)) continue;
      const n = lineOf(utterances, i);
      if (n) out.set(i, n);
    }
  }
  return [...out.values()].sort((a, b) => a.index - b.index);
}

/** 表示を控えた文（engine/guard.mts）は記録に入れない */
function keep(text: string | null | undefined, field: string, withheld: string[]): string {
  const t = (text ?? "").trim();
  if (t === WITHHELD_NOTICE) {
    withheld.push(field);
    return "";
  }
  return t;
}

/**
 * 分析の結果から、1 回の面談の記録を作る。
 * 入れるのは、面談の日付・照合済みの引用・前後の発話・AI が書いた観察・選んだ行動・次の回に現れた発言。読みは aiReading に分ける。点と判定は入れない。
 * 出所ごとの分け方は renderRecord の見出し。
 */
export function buildFactRecord(input: FactRecordInput): FactRecord {
  assertNoSelfEvaluation(input);
  if (!INTERVIEW_ID.test(input.interviewId)) throw new Error(`面談 ID は英小文字・数字・ハイフンだけにしてください：${input.interviewId}`);
  if (input.followsInterviewId !== null && !INTERVIEW_ID.test(input.followsInterviewId)) throw new Error(`前の面談の ID が読めません：${input.followsInterviewId}`);
  if (!INTERVIEW_DATE.test(input.date)) throw new Error(`面談の日付は YYYY-MM-DD にしてください：${input.date}`);
  const withheld: string[] = [];
  let unverified = 0;

  const scenes: RecordScene[] = [];
  const readings: RecordAiReading["scenes"] = [];
  (input.step1?.scenes ?? []).forEach((sc, i) => {
    const q = quoteLines(sc.quotes, input.utterances);
    unverified += q.droppedCount;
    scenes.push({
      type: sc.type,
      context: keep(sc.context, `scenes[${i}].context`, withheld),
      quotes: q.lines,
      neighbors: neighborLines(q.lines, input.utterances),
      observation: keep(sc.observation, `scenes[${i}].observation`, withheld),
      reaction: keep(sc.reaction, `scenes[${i}].reaction`, withheld),
    });
    const asChoice = sc.asChoice === null ? null : keep(sc.asChoice, `scenes[${i}].asChoice`, withheld) || null;
    readings.push({ type: sc.type, reading: keep(sc.reading, `scenes[${i}].reading`, withheld), asChoice });
  });

  let followUp: RecordFollowUp | null = null;
  let otherPersonLine: string | null = null;
  if (input.followUp) {
    const q = quoteLines(input.followUp.quotes, input.utterances);
    unverified += q.droppedCount;
    followUp = {
      previousInterviewId: input.followUp.previousInterviewId,
      previousAction: input.followUp.previousAction.trim(),
      previousActionOrigin: input.followUp.previousActionOrigin,
      criterion: input.followUp.criterion?.trim() || null,
      quotes: q.lines,
      neighbors: neighborLines(q.lines, input.utterances),
    };
    otherPersonLine = keep(input.followUp.otherPersonLine, "followUp.otherPersonLine", withheld) || null;
  }

  return {
    interviewId: input.interviewId,
    date: input.date,
    kind: input.kind,
    order: input.order,
    otherTag: input.otherTag,
    followsInterviewId: input.followsInterviewId,
    status: input.status,
    utteranceCount: input.utterances.length,
    scenes,
    noScene: input.step1?.noScene ? keep(input.step1.noScene, "noScene", withheld) || null : null,
    action: input.chosenAction ? { sentence: input.chosenAction.sentence.trim(), criterion: input.chosenAction.criterion?.trim() || null, origin: input.chosenAction.origin } : null,
    followUp,
    aiReading: {
      scenes: readings,
      otherPersonLine,
    },
    dropped: { unverifiedQuotes: unverified, withheldFields: withheld },
  };
}

/** メモリストアの中の、記録のファイルの場所（1 回 1 ファイル。面談の日付をファイル名に入れる） */
export function recordPath(interviewId: string, date: string): string {
  return `/records/${date}-${interviewId}.md`;
}

/** 索引のファイルの場所。記録係が毎回 1 行足し、夢が作り直す */
export const INDEX_PATH = "/index.md";

/** 発話の行。「> 〔発話 40〕講師：本文」。夢の根拠と、読み返しの検査で、この形の行を原文として扱う */
export function quoteLineText(l: RecordLine): string {
  return `> ${blockLabel(l.index)}${l.speaker}：${l.text}`;
}

function linesBlock(lines: RecordLine[]): string {
  return lines.map(quoteLineText).join("\n");
}

/** 記録の形の版。形が変わったら上げる（前の形のメモリストアに、続けて書かない） */
export const RECORD_FORMAT = 3;

export const ORIGINAL_HEADING = "## 原文（発話の本文そのまま）";
export const ACTION_HEADING = "## 行動（どう決まったかを添える）";
export const AI_WRITTEN_HEADING = "## AI が書いた説明（原文と照合していない。事実ではない）";
export const AI_READING_HEADING = "## その回の AI の読み（仮説）";
export const FOLLOW_UP_HEADING = "### 前回の行動に対して、この回に現れた発言";
const FOLLOW_UP_QUOTES_LABEL = "- この回に現れた発言（照合済み）";

export type RenderOptions = {
  /** 「その回の AI の読み（仮説）」を入れるか。既定は入れる */
  includeAiReading?: boolean;
};

/** 記録を Markdown にする。記録係はこの文をそのままファイルに書く */
export function renderRecord(r: FactRecord, opts: RenderOptions = {}): string {
  const includeAi = opts.includeAiReading !== false;
  const out: string[] = [];
  out.push("---");
  out.push(`interview: ${r.interviewId}`);
  out.push(`date: ${r.date}`);
  out.push(`record_format: ${RECORD_FORMAT}`);
  out.push(`kind: ${r.kind}`);
  out.push(`order: ${r.order}`);
  out.push(`other: ${r.otherTag ?? "（札なし）"}`);
  out.push(`follows: ${r.followsInterviewId ?? "（なし）"}`);
  out.push(`status: ${r.status}`);
  out.push(`utterances: ${r.utteranceCount}`);
  out.push("---");
  out.push("");
  out.push(`# 面談の記録：${r.date} ${r.interviewId}`);
  out.push("");
  out.push(ORIGINAL_HEADING);
  out.push("");
  out.push("「>」で始まる行だけが、発話の本文そのまま（原文と一致を確かめた引用と、アプリが発話番号から取った前後の発話）。どの発話を場面に選んだかは、AI の選択。");
  out.push("");
  if (r.scenes.length === 0) {
    out.push("- 場面：なし");
    out.push("");
  }
  r.scenes.forEach((sc, i) => {
    out.push(`### 場面 ${i + 1}：${sc.type}`);
    out.push("");
    if (sc.quotes.length > 0) {
      out.push("- 引用（照合済み）：");
      out.push("");
      out.push(linesBlock(sc.quotes));
      out.push("");
    } else {
      out.push("- 引用：なし（原文と一致した引用が無かった）");
    }
    if (sc.neighbors.length > 0) {
      out.push("- 前後の発話：");
      out.push("");
      out.push(linesBlock(sc.neighbors));
      out.push("");
    }
    out.push("");
  });
  if (r.followUp) {
    out.push(FOLLOW_UP_HEADING);
    out.push("");
    if (r.followUp.quotes.length > 0) {
      out.push(`${FOLLOW_UP_QUOTES_LABEL}：`);
      out.push("");
      out.push(linesBlock(r.followUp.quotes));
      out.push("");
    } else {
      out.push(`${FOLLOW_UP_QUOTES_LABEL.replace("（照合済み）", "")}：なし`);
    }
    if (r.followUp.neighbors.length > 0) {
      out.push("- 前後の発話：");
      out.push("");
      out.push(linesBlock(r.followUp.neighbors));
      out.push("");
    }
    out.push("");
  }
  out.push(ACTION_HEADING);
  out.push("");
  if (r.followUp) {
    out.push("### 前回の行動");
    out.push("");
    out.push(`- 前回の面談：${r.followUp.previousInterviewId ?? "（記録なし）"}`);
    out.push(`- 行動：${r.followUp.previousAction}`);
    out.push(`- できたかの基準：${r.followUp.criterion ?? "（決めていない）"}`);
    out.push(`- 決まり方：${r.followUp.previousActionOrigin}`);
    out.push("");
  }
  out.push("### この回に決めた行動");
  out.push("");
  if (r.action) {
    out.push(`- 行動：${r.action.sentence}`);
    out.push(`- できたかの基準：${r.action.criterion ?? "（決めていない）"}`);
    out.push(`- 決まり方：${r.action.origin}`);
  } else {
    out.push("- 行動：なし（この回の記録には、決めた行動が無い）");
  }
  out.push("");
  out.push(AI_WRITTEN_HEADING);
  out.push("");
  out.push("AI が書いた文で、確かめていない。発話の本文は上の「原文」を見る。");
  out.push("");
  if (r.scenes.length === 0 && r.noScene) out.push(`- 場面が無い理由：${r.noScene}`);
  r.scenes.forEach((sc, i) => {
    if (sc.context) out.push(`- 場面 ${i + 1} の文脈：${sc.context}`);
    if (sc.observation) out.push(`- 場面 ${i + 1} の観察：${sc.observation}`);
    if (sc.reaction) out.push(`- 場面 ${i + 1} の直後の相手の反応：${sc.reaction}`);
  });
  out.push("");
  if (includeAi) {
    out.push(AI_READING_HEADING);
    out.push("");
    out.push("その回の AI の読みで、事実ではない。本人は確かめていない。あとの面談の原文で、直すことも保留にすることもある。");
    out.push("");
    r.aiReading.scenes.forEach((s, i) => {
      if (s.reading) out.push(`- 場面 ${i + 1} の読み：${s.reading}`);
      if (s.asChoice) out.push(`- 場面 ${i + 1} を意図した選択として見ると：${s.asChoice}`);
    });
    if (r.aiReading.otherPersonLine) out.push(`- 相手が前回決めたことの語られ方：${r.aiReading.otherPersonLine}`);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** 索引に足す 1 行。記録係が毎回足す（夢が作り直す） */
export function indexLine(r: FactRecord): string {
  const scenes = r.scenes.length === 0 ? "場面なし" : r.scenes.map((s) => `${s.type}（${s.quotes.length > 0 ? utteranceLabel(s.quotes[0].index) : "引用なし"}）`).join("・");
  const follow = r.followUp ? `追跡：${r.followUp.previousInterviewId ?? "前回"} の行動` : "追跡：なし";
  const action = r.action ? "決めた行動：あり" : "決めた行動：なし";
  return `- ${recordPath(r.interviewId, r.date).slice(1)}｜${r.date}｜${r.order} 本目｜${r.kind}｜${r.otherTag ?? "札なし"}｜${scenes}｜${follow}｜${action}｜${r.status}`;
}

export type NameHit = { name: string; field: string; context: string };

export type ScoreHit = { word: string; field: string; context: string };

export type RecordCheck = {
  /** 人物の性質の言葉（決まり 3）。引用の行と「」の中は数えない */
  traitHits: ForbiddenHit[];
  /** 点の数字と判定の言葉（決まり 10）。引用の行と「」の中は数えない */
  scoreHits: ScoreHit[];
  /** 相手の名前（札にした呼び名など）。引用の中も数える */
  nameHits: NameHit[];
  /** 照らした名前の一覧の数。0 なら、名前の検査はしていない（0 件とは書かない） */
  nameListSize: number;
  ok: boolean;
};

const listSize = (names: string[]) => names.filter((n) => n.trim() !== "").length;

/**
 * 点の数字と判定の言葉の形（決まり 10）。ふつうの文の「できた日」「まだ分からない」「数学が 51 点」は当てない。
 * 模試の判定（「D 判定」「模試の判定」）は面談の判定ではないので当てない。
 */
const SCORE_PATTERNS: { word: string; re: RegExp }[] = [
  { word: "判定", re: /(?<![A-EＡ-Ｅ]\s?|模試の)判定/g },
  { word: "項目ごとの点", re: /項目\s*[1-5１-５]\s*[＝=：:]\s*(?:[1-5１-５]|判定)/g },
  { word: "面談の点", re: /(?:面談|AI|Ａ Ｉ|自分|本人)の点|自己採点|自己評価/g },
  { word: "点の形", re: /\d+(?:\.\d+)?\s*[／/]\s*(?:10|20|25)(?![\d])/g },
  { word: "判定の言葉（欄の値）", re: /[：:|｜]\s*(?:できた|一部|まだ|場面がなかった)\s*(?=$|[|｜\n。])/gm },
];

/** 点の数字と判定の言葉を探す。発話の本文の行（「>」）と「」の中は、言った言葉そのままなので数えない */
export function scanScoreWords(markdown: string, field: string): ScoreHit[] {
  const body = withoutQuoteLines(markdown).replace(/「[^」]*」/g, (m) => "　".repeat([...m].length));
  const hits: ScoreHit[] = [];
  for (const { word, re } of SCORE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const at = m.index ?? 0;
      hits.push({ word, field, context: body.slice(Math.max(0, at - 12), at + m[0].length + 12).replace(/\n/g, " ") });
    }
  }
  return hits;
}

/**
 * 名前の検査の結果を、言える範囲で書く。一覧との一致を探すだけなので、一覧に無い名前は見つけられない。
 * 一覧を渡していないときは「0 件」と書かない。
 */
export function nameCheckLabel(nameListSize: number, hits: number): string {
  if (nameListSize === 0) return "未検査（名前の一覧を渡していない）";
  return `${hits} 件（一覧の ${nameListSize} 件と照らした。一覧に無い名前は見つけられない）`;
}

function findNames(text: string, field: string, names: string[]): NameHit[] {
  const hits: NameHit[] = [];
  for (const name of names) {
    const n = name.trim();
    if (n === "") continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(n, from);
      if (at < 0) break;
      hits.push({ name: n, field, context: text.slice(Math.max(0, at - 12), at + n.length + 12) });
      from = at + n.length;
    }
  }
  return hits;
}

/**
 * 書く前の検査。AI が書いた文と行動の文に、人物の性質の言葉が無いか。どの欄にも、相手の名前が無いか。
 * 引用と前後の発話は、言った言葉そのままなので性質の言葉は数えない（名前は数える）。
 */
export function checkRecord(r: FactRecord, names: string[] = [], opts: RenderOptions = {}): RecordCheck {
  const includeAi = opts.includeAiReading !== false;
  const authored: { field: string; text: string }[] = [];
  const spoken: { field: string; text: string }[] = [];
  r.scenes.forEach((sc, i) => {
    authored.push({ field: `scenes[${i}].context`, text: sc.context }, { field: `scenes[${i}].observation`, text: sc.observation }, { field: `scenes[${i}].reaction`, text: sc.reaction });
    [...sc.quotes, ...sc.neighbors].forEach((l) => spoken.push({ field: `scenes[${i}].${utteranceLabel(l.index)}`, text: l.text }));
  });
  if (r.noScene) authored.push({ field: "noScene", text: r.noScene });
  if (r.action) authored.push({ field: "action.sentence", text: r.action.sentence }, { field: "action.criterion", text: r.action.criterion ?? "" }, { field: "action.origin", text: r.action.origin });
  if (r.followUp) {
    authored.push({ field: "followUp.previousAction", text: r.followUp.previousAction }, { field: "followUp.criterion", text: r.followUp.criterion ?? "" });
    [...r.followUp.quotes, ...r.followUp.neighbors].forEach((l) => spoken.push({ field: `followUp.${utteranceLabel(l.index)}`, text: l.text }));
  }
  if (includeAi) {
    r.aiReading.scenes.forEach((s, i) => authored.push({ field: `aiReading.scenes[${i}].reading`, text: s.reading }, { field: `aiReading.scenes[${i}].asChoice`, text: s.asChoice ?? "" }));
    authored.push({ field: "aiReading.otherPersonLine", text: r.aiReading.otherPersonLine ?? "" });
  }
  authored.push({ field: "otherTag", text: r.otherTag ?? "" }, { field: "status", text: r.status });
  const traitHits = authored.flatMap((a) => scanText(a.text, a.field));
  const scoreHits = authored.flatMap((a) => scanScoreWords(a.text, a.field));
  const nameHits = [...authored, ...spoken].flatMap((a) => findNames(a.text, a.field, names));
  return { traitHits, scoreHits, nameHits, nameListSize: listSize(names), ok: traitHits.length === 0 && scoreHits.length === 0 && nameHits.length === 0 };
}

/** Markdown から、発話の本文そのままの行（「>」で始まる行）を除く */
export function withoutQuoteLines(markdown: string): string {
  return markdown
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n");
}

/**
 * 読み返したファイル（メモリストアから読んだ文）の検査。記録にも、夢の出力にも使う。
 * 発話の本文そのままの行（「>」の行）と「」の中は、性質の言葉と、点・判定の言葉を数えない。名前は全文で数える。
 */
export function checkMarkdown(markdown: string, field: string, names: string[] = []): RecordCheck {
  const traitHits = scanText(withoutQuoteLines(markdown), field);
  const scoreHits = scanScoreWords(markdown, field);
  const nameHits = findNames(markdown, field, names);
  return { traitHits, scoreHits, nameHits, nameListSize: listSize(names), ok: traitHits.length === 0 && scoreHits.length === 0 && nameHits.length === 0 };
}

export type Correction = { oldText: string; newText: string };

/**
 * 本人の訂正を、記録の文に当てる。直す文がちょうど 1 か所のときだけ当てる。
 * 「>」の行は発話の本文なので直せない（直すなら画面 1 で文字起こしを直す）。
 * 訂正した記録には frontmatter に印を付ける。夢に渡すセッションから、この記録のセッションを外す印になる。
 */
export function applyCorrection(markdown: string, c: Correction): string {
  const oldText = c.oldText.trim();
  if (oldText === "" || c.newText.trim() === "") throw new Error("訂正の前の文と後の文を入れてください");
  const lines = markdown.split("\n");
  if (lines.some((l) => /^\s*>/.test(l) && l.includes(oldText))) throw new Error("「>」の行は発話の本文なので、ここでは直せません");
  const count = markdown.split(oldText).length - 1;
  if (count !== 1) throw new Error(`直す文は、ちょうど 1 か所にしてください（${count} か所）`);
  const replaced = markdown.replace(oldText, () => c.newText.trim());
  if (/^corrected: /m.test(replaced)) return replaced;
  return replaced.replace(/^status: .*$/m, (m) => `${m}\ncorrected: 本人が直した`);
}
