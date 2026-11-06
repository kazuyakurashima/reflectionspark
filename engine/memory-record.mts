// 記録係に渡す「事実の記録」を作る（docs/設計書.md 工程 5 と「覚えていると整理」、決まり 3・10・12）。
// ここは純粋な関数だけ。Managed Agents の呼び出しは engine/recorder.mts。
//
// 記録の形：1 回の面談につき 1 ファイル。場面と行動と結果だけ。回をまたいだ変化は書かない（夢で出す）。
// - 「事実」：照合済みの引用（発話番号つき）、前後の発話（アプリが発話番号から取る）、AI が書いた観察、選んだ行動、追跡の判定と根拠の引用。
// - 「その回の AI の読み（仮説）」：読み、意図した選択として見たとき、なぜの一文、項目ごとの点。事実と分けて書き、外せる（includeAiReading）。
// 渡さないもの：本人の自己採点・自己評価・一言、文字起こしの全文。相手の名前と、人物の性質の言葉は書かない。

import { quoteMatchesTranscript } from "./citations.mts";
import { scanText } from "./forbidden-words.mts";
import type { ForbiddenHit } from "./forbidden-words.mts";
import { WITHHELD_NOTICE } from "./guard.mts";
import type { FollowUpVerdict, ItemNumber, ItemScore, MeetingKind, Quote, Scene, SceneType, Utterance } from "./types.mts";
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
  criterion: string | null;
  /** AI の判定。本人の自己評価は記録に入れない */
  verdict: FollowUpVerdict;
  quotes: RecordLine[];
  neighbors: RecordLine[];
};

export type RecordAiReading = {
  scenes: { type: SceneType; reading: string; asChoice: string | null }[];
  followUpWhy: string | null;
  otherPersonLine: string | null;
  /** 面談の点（人の点ではない）。どの工程の点か */
  scores: { item: ItemNumber; score: number | null }[];
  scoresFrom: "工程 2" | "工程 4" | null;
};

export type FactRecord = {
  interviewId: string;
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
  kind: MeetingKind;
  order: number;
  otherTag: string | null;
  followsInterviewId: string | null;
  status: string;
  /** 整形後の発話の並び。引用の確かめ直しと、前後の発話を取るためだけに使う。記録には全文を書かない */
  utterances: Utterance[];
  step1: { scenes: Scene[]; noScene: string | null } | null;
  step2: { items: ItemScore[] } | null;
  chosenAction: RecordAction | null;
  followUp: {
    previousInterviewId: string | null;
    previousAction: string;
    criterion: string | null;
    step4: { verdict: FollowUpVerdict; quotes: Quote[]; why: string; items: ItemScore[]; otherPersonLine: string | null };
  } | null;
};

/** 面談 ID に使える文字（メモリのパスと、夢の根拠の書き方に使うので、英数字とハイフンだけ） */
const INTERVIEW_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** 記録係に渡してはいけない欄の名前（本人の自己採点・自己評価・一言。決まり 10 と工程 5 の「渡さない」） */
const SELF_KEYS = /^(self|demoSelf)|自己|本人の(点|一言|評価)/i;

/** 入力に、本人の自己採点・自己評価らしい欄が紛れていないかを確かめる。あれば投げる */
export function assertNoSelfEvaluation(input: unknown, path = "input"): void {
  if (Array.isArray(input)) {
    input.forEach((v, i) => assertNoSelfEvaluation(v, `${path}[${i}]`));
    return;
  }
  if (!input || typeof input !== "object") return;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SELF_KEYS.test(k)) throw new Error(`記録係に渡せない欄があります：${path}.${k}（本人の自己採点・自己評価は記録に入れない）`);
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
 * 入れるのは、照合済みの引用・前後の発話・AI が書いた観察・選んだ行動・追跡の判定と根拠。読みと点は aiReading に分ける。
 */
export function buildFactRecord(input: FactRecordInput): FactRecord {
  assertNoSelfEvaluation(input);
  if (!INTERVIEW_ID.test(input.interviewId)) throw new Error(`面談 ID は英小文字・数字・ハイフンだけにしてください：${input.interviewId}`);
  if (input.followsInterviewId !== null && !INTERVIEW_ID.test(input.followsInterviewId)) throw new Error(`前の面談の ID が読めません：${input.followsInterviewId}`);
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
  let followUpWhy: string | null = null;
  let otherPersonLine: string | null = null;
  if (input.followUp) {
    const q = quoteLines(input.followUp.step4.quotes, input.utterances);
    unverified += q.droppedCount;
    followUp = {
      previousInterviewId: input.followUp.previousInterviewId,
      previousAction: input.followUp.previousAction.trim(),
      criterion: input.followUp.criterion?.trim() || null,
      verdict: input.followUp.step4.verdict,
      quotes: q.lines,
      neighbors: neighborLines(q.lines, input.utterances),
    };
    followUpWhy = keep(input.followUp.step4.why, "followUp.why", withheld) || null;
    otherPersonLine = keep(input.followUp.step4.otherPersonLine, "followUp.otherPersonLine", withheld) || null;
  }

  // 点は、続きの面談では工程 4、それ以外は工程 2 のもの
  const scoreItems = input.followUp ? input.followUp.step4.items : input.step2?.items ?? [];
  const scoresFrom = input.followUp ? "工程 4" : input.step2 ? "工程 2" : null;

  return {
    interviewId: input.interviewId,
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
      followUpWhy,
      otherPersonLine,
      scores: scoreItems.map((it) => ({ item: it.item, score: it.score })),
      scoresFrom,
    },
    dropped: { unverifiedQuotes: unverified, withheldFields: withheld },
  };
}

/** メモリストアの中の、記録のファイルの場所（1 回 1 ファイル） */
export function recordPath(interviewId: string): string {
  return `/records/${interviewId}.md`;
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

export const FACT_HEADING = "## 事実";
export const AI_READING_HEADING = "## その回の AI の読み（仮説）";

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
  out.push(`kind: ${r.kind}`);
  out.push(`order: ${r.order}`);
  out.push(`other: ${r.otherTag ?? "（札なし）"}`);
  out.push(`follows: ${r.followsInterviewId ?? "（なし）"}`);
  out.push(`status: ${r.status}`);
  out.push(`utterances: ${r.utteranceCount}`);
  out.push("---");
  out.push("");
  out.push(`# 面談の記録：${r.interviewId}`);
  out.push("");
  out.push(FACT_HEADING);
  out.push("");
  out.push("「>」で始まる行は、発話の本文そのまま（原文と一致を確かめた引用と、その前後の発話）。観察は AI が書いた文で、原文との照合はしていない。");
  out.push("");
  if (r.scenes.length === 0) {
    out.push(`- 場面：なし${r.noScene ? `（${r.noScene}）` : ""}`);
    out.push("");
  }
  r.scenes.forEach((sc, i) => {
    out.push(`### 場面 ${i + 1}：${sc.type}`);
    out.push("");
    if (sc.context) out.push(`- 文脈：${sc.context}`);
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
    if (sc.observation) out.push(`- 観察：${sc.observation}`);
    if (sc.reaction) out.push(`- 直後の相手の反応：${sc.reaction}`);
    out.push("");
  });
  if (r.followUp) {
    out.push("### 前回の行動の追跡");
    out.push("");
    out.push(`- 前回の面談：${r.followUp.previousInterviewId ?? "（記録なし）"}`);
    out.push(`- 前回の行動：${r.followUp.previousAction}`);
    out.push(`- できたかの基準：${r.followUp.criterion ?? "（決めていない）"}`);
    out.push(`- 判定（AI。本人の自己評価は記録に入れない）：${r.followUp.verdict}`);
    if (r.followUp.quotes.length > 0) {
      out.push("- 根拠の引用（照合済み）：");
      out.push("");
      out.push(linesBlock(r.followUp.quotes));
      out.push("");
    } else {
      out.push("- 根拠の引用：なし");
    }
    if (r.followUp.neighbors.length > 0) {
      out.push("- 前後の発話：");
      out.push("");
      out.push(linesBlock(r.followUp.neighbors));
      out.push("");
    }
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
  if (includeAi) {
    out.push(AI_READING_HEADING);
    out.push("");
    out.push("その回の AI の読みで、事実ではない。本人は確かめていない。あとの面談の事実で、直すことも保留にすることもある。");
    out.push("");
    r.aiReading.scenes.forEach((s, i) => {
      if (s.reading) out.push(`- 場面 ${i + 1} の読み：${s.reading}`);
      if (s.asChoice) out.push(`- 場面 ${i + 1} を意図した選択として見ると：${s.asChoice}`);
    });
    if (r.aiReading.followUpWhy) out.push(`- 追跡の判定のなぜ：${r.aiReading.followUpWhy}`);
    if (r.aiReading.otherPersonLine) out.push(`- 相手が前回決めたことの語られ方：${r.aiReading.otherPersonLine}`);
    if (r.aiReading.scoresFrom) {
      const s = r.aiReading.scores.map((x) => `項目 ${x.item}＝${x.score ?? "判定しない"}`).join("、");
      out.push(`- 面談の点（${r.aiReading.scoresFrom}。人の点ではない）：${s}`);
    }
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** 索引に足す 1 行。記録係が毎回足す（夢が作り直す） */
export function indexLine(r: FactRecord): string {
  const scenes = r.scenes.length === 0 ? "場面なし" : r.scenes.map((s) => `${s.type}（${s.quotes.length > 0 ? utteranceLabel(s.quotes[0].index) : "引用なし"}）`).join("・");
  const follow = r.followUp ? `追跡：${r.followUp.previousInterviewId ?? "前回"} の行動 → ${r.followUp.verdict}` : "追跡：なし";
  const action = r.action ? "決めた行動：あり" : "決めた行動：なし";
  return `- ${recordPath(r.interviewId).slice(1)}｜${r.order} 本目｜${r.kind}｜${r.otherTag ?? "札なし"}｜${scenes}｜${follow}｜${action}｜${r.status}`;
}

export type NameHit = { name: string; field: string; context: string };

export type RecordCheck = {
  /** 人物の性質の言葉（決まり 3）。引用の行と「」の中は数えない */
  traitHits: ForbiddenHit[];
  /** 相手の名前（札にした呼び名など）。引用の中も数える */
  nameHits: NameHit[];
  ok: boolean;
};

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
    authored.push({ field: "aiReading.followUpWhy", text: r.aiReading.followUpWhy ?? "" }, { field: "aiReading.otherPersonLine", text: r.aiReading.otherPersonLine ?? "" });
  }
  authored.push({ field: "otherTag", text: r.otherTag ?? "" }, { field: "status", text: r.status });
  const traitHits = authored.flatMap((a) => scanText(a.text, a.field));
  const nameHits = [...authored, ...spoken].flatMap((a) => findNames(a.text, a.field, names));
  return { traitHits, nameHits, ok: traitHits.length === 0 && nameHits.length === 0 };
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
 * 発話の本文そのままの行（「>」の行）と「」の中は、性質の言葉を数えない。名前は全文で数える。
 */
export function checkMarkdown(markdown: string, field: string, names: string[] = []): RecordCheck {
  const traitHits = scanText(withoutQuoteLines(markdown), field);
  const nameHits = findNames(markdown, field, names);
  return { traitHits, nameHits, ok: traitHits.length === 0 && nameHits.length === 0 };
}
