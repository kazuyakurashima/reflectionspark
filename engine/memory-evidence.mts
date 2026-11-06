// 夢（Dreams）の出力の根拠を、発話の原文と照合する（docs/設計書.md「覚えていると整理」、決まり 1・3）。
// 夢には、根拠を「〔面談ID｜発話 n〕話者：「引用」」の形で 1 行に 1 つ書かせる（指示は engine/recorder.mts の DREAM_INSTRUCTIONS）。
// ここは純粋な関数だけ。読み取り、照合、仮説ごとの数え上げ。
//
// 照合で分かるのは「その面談のその番号の発話に、その言葉がある」ことまで。
// その発話が仮説を支えるかは、ここでは分からない（人が読むか、別の判定で確かめる）。

import { looseKey } from "./text.mts";
import type { Utterance } from "./types.mts";

export type EvidenceRef = {
  interviewId: string;
  /** 発話番号（範囲のときは始まり） */
  index: number;
  /** 範囲のときの終わり（含む）。1 つなら index と同じ */
  lastIndex: number;
  /** 書いてあった話者（無ければ null） */
  speaker: string | null;
  /** 「」の中の言葉（無ければ null） */
  quote: string | null;
  /** 何行目か（1 始まり） */
  line: number;
};

const DIGITS = "[0-9０-９]+";
const REF = new RegExp(`〔\\s*([A-Za-z0-9][A-Za-z0-9_-]*)\\s*[｜|]\\s*発話\\s*(${DIGITS})(?:\\s*[〜～~–-]\\s*(?:発話\\s*)?(${DIGITS}))?\\s*〕`, "gu");

function toNumber(s: string): number {
  return Number(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

/** 札のあとの文から、話者と「」の中の言葉を取る。「」は最初の「から最後の」まで（引用の中の「」を切らない） */
function speakerAndQuote(rest: string): { speaker: string | null; quote: string | null } {
  const open = rest.indexOf("「");
  const close = rest.lastIndexOf("」");
  const head = open >= 0 ? rest.slice(0, open) : rest;
  const sp = /^[\s*＊]*([^\s：:「」|｜*]{1,10})[：:]/u.exec(head);
  const quote = open >= 0 && close > open ? rest.slice(open + 1, close) : null;
  return { speaker: sp ? sp[1] : null, quote };
}

/** 文の中の根拠（〔面談ID｜発話 n〕話者：「引用」）をすべて取る。1 行にいくつかあれば、次の札の手前までを 1 つ分とする */
export function parseEvidenceRefs(markdown: string): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  markdown.split("\n").forEach((lineText, i) => {
    const matches = [...lineText.matchAll(REF)];
    matches.forEach((m, k) => {
      const start = (m.index ?? 0) + m[0].length;
      const end = k + 1 < matches.length ? matches[k + 1].index ?? lineText.length : lineText.length;
      const { speaker, quote } = speakerAndQuote(lineText.slice(start, end));
      const index = toNumber(m[2]);
      out.push({ interviewId: m[1], index, lastIndex: m[3] ? toNumber(m[3]) : index, speaker, quote, line: i + 1 });
    });
  });
  return out;
}

export type EvidenceStatus =
  | "全文一致" // 引用が、その番号の発話の本文と一字一句同じ
  | "一部一致" // 引用が、その番号の発話の本文の一部（縮めて写した）
  | "記号だけ違う" // 句読点・空白・記号を除けば同じ（一字一句は合わない）
  | "番号ちがい" // 同じ面談の別の発話にある
  | "面談ちがい" // 別の面談の発話にある
  | "不一致" // どの面談の発話にも無い
  | "範囲の外" // その面談に、その番号の発話が無い
  | "面談が無い" // 面談 ID が記録に無い
  | "引用なし"; // 番号だけ（番号が範囲にあることだけ確かめた）

export type EvidenceCheck = EvidenceRef & {
  status: EvidenceStatus;
  /** 書いてあった話者が、その発話の話者と同じか（話者が無ければ null） */
  speakerMatches: boolean | null;
  /** その番号の発話の話者と本文（人が読んで確かめるため。範囲の外なら null） */
  actual: { speaker: string; text: string }[] | null;
  /** 番号ちがい・面談ちがいのとき、見つかった所 */
  foundAt: { interviewId: string; index: number }[];
};

function textOf(u: Utterance): string {
  return u.text ?? "";
}

function findIn(utterances: Utterance[], quote: string): number[] {
  return utterances.filter((u) => textOf(u) !== "" && textOf(u).includes(quote)).map((u) => u.index);
}

/** 根拠を 1 つ照合する。transcripts は、面談 ID ごとの整形後の発話の並び */
export function verifyEvidenceRef(ref: EvidenceRef, transcripts: Record<string, Utterance[]>): EvidenceCheck {
  const base: Omit<EvidenceCheck, "status"> = { ...ref, speakerMatches: null, actual: null, foundAt: [] };
  const utterances = transcripts[ref.interviewId];
  if (!utterances) return { ...base, status: "面談が無い" };
  const inRange = ref.index >= 0 && ref.lastIndex >= ref.index && ref.lastIndex < utterances.length;
  if (!inRange) return { ...base, status: "範囲の外" };
  const range = utterances.slice(ref.index, ref.lastIndex + 1);
  const actual = range.map((u) => ({ speaker: u.speaker, text: textOf(u) }));
  const speakerMatches = ref.speaker === null ? null : range.some((u) => u.speaker === ref.speaker);
  const withActual = { ...base, actual, speakerMatches };
  if (ref.quote === null || ref.quote.trim() === "") return { ...withActual, status: "引用なし" };
  const quote = ref.quote.trim();
  const joined = [range.map(textOf).join(""), range.map(textOf).join("\n")];
  if (range.some((u) => textOf(u) === quote) || joined.includes(quote)) return { ...withActual, status: "全文一致" };
  if (range.some((u) => textOf(u).includes(quote)) || joined.some((j) => j.includes(quote))) return { ...withActual, status: "一部一致" };
  const key = looseKey(quote);
  if (key !== "" && range.some((u) => looseKey(textOf(u)).includes(key))) return { ...withActual, status: "記号だけ違う" };
  const same = findIn(utterances, quote);
  if (same.length > 0) return { ...withActual, status: "番号ちがい", foundAt: same.map((index) => ({ interviewId: ref.interviewId, index })) };
  const others = Object.entries(transcripts)
    .filter(([id]) => id !== ref.interviewId)
    .flatMap(([id, us]) => findIn(us, quote).map((index) => ({ interviewId: id, index })));
  if (others.length > 0) return { ...withActual, status: "面談ちがい", foundAt: others };
  return { ...withActual, status: "不一致" };
}

export function verifyEvidence(refs: EvidenceRef[], transcripts: Record<string, Utterance[]>): EvidenceCheck[] {
  return refs.map((r) => verifyEvidenceRef(r, transcripts));
}

export type EvidenceSummary = {
  total: number;
  byStatus: Partial<Record<EvidenceStatus, number>>;
  /** 引用つきの根拠のうち、番号も言葉も原文と合ったもの（全文一致と一部一致） */
  matched: number;
  withQuote: number;
  /** 話者を書いた根拠のうち、発話の話者と違ったもの */
  speakerMismatch: number;
};

export function summarizeEvidence(checks: EvidenceCheck[]): EvidenceSummary {
  const byStatus: Partial<Record<EvidenceStatus, number>> = {};
  for (const c of checks) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  return {
    total: checks.length,
    byStatus,
    matched: (byStatus["全文一致"] ?? 0) + (byStatus["一部一致"] ?? 0),
    withQuote: checks.filter((c) => c.quote !== null && c.quote.trim() !== "").length,
    speakerMismatch: checks.filter((c) => c.speakerMatches === false).length,
  };
}

export type Hypothesis = {
  /** 「H1」など */
  id: string;
  /** 仮説の一文 */
  statement: string;
  /** 確からしさ（高・中・低・保留。読めなければ null） */
  confidence: string | null;
  /** 場面の形（読めなければ空） */
  sceneShape: string;
  evidence: EvidenceRef[];
  counter: EvidenceRef[];
  /** 例外・反例の欄に書いてあった、根拠の形でない文（「見当たらない」など） */
  counterNote: string;
  /** 根拠にある面談 ID（重なりを除く） */
  interviews: string[];
  startLine: number;
};

const HYPOTHESIS_HEADING = /^#{2,4}\s*仮説\s*([A-Za-zＨ]?\s*[0-9０-９]+)\s*[：:]\s*(.*)$/u;
const FIELD = /^\s*[-*・]\s*\**(確からしさ|場面の形|根拠|例外・反例|例外|反例|まだ分からないこと)\**\s*[：:]\s*(.*)$/u;

/** 夢の「繰り返す場面」のファイルから、仮説ごとに、確からしさ・根拠・例外や反例を取る */
export function parseHypotheses(markdown: string): Hypothesis[] {
  const lines = markdown.split("\n");
  const out: Hypothesis[] = [];
  let cur: Hypothesis | null = null;
  let field: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const h = HYPOTHESIS_HEADING.exec(lineText);
    if (h) {
      cur = { id: h[1].replace(/\s/g, "").replace("Ｈ", "H"), statement: h[2].trim(), confidence: null, sceneShape: "", evidence: [], counter: [], counterNote: "", interviews: [], startLine: i + 1 };
      out.push(cur);
      field = null;
      continue;
    }
    if (/^#{1,4}\s/.test(lineText)) {
      cur = null;
      field = null;
      continue;
    }
    if (!cur) continue;
    const f = FIELD.exec(lineText);
    let rest = lineText;
    if (f) {
      field = f[1] === "例外" || f[1] === "反例" ? "例外・反例" : f[1];
      rest = f[2];
      if (field === "確からしさ") cur.confidence = (/(高|中|低|保留)/u.exec(rest)?.[1] ?? rest.trim()) || null;
      if (field === "場面の形") cur.sceneShape = rest.trim();
    }
    if (field !== "根拠" && field !== "例外・反例") continue;
    const refs = parseEvidenceRefs(rest).map((r) => ({ ...r, line: i + 1 }));
    if (field === "根拠") cur.evidence.push(...refs);
    else if (refs.length > 0) cur.counter.push(...refs);
    else if (rest.trim() !== "") cur.counterNote = `${cur.counterNote}${cur.counterNote ? " " : ""}${rest.trim().replace(/^[-*・]\s*/, "")}`;
  }
  for (const h of out) h.interviews = [...new Set(h.evidence.map((e) => e.interviewId))];
  return out;
}

export type HypothesisSummary = {
  total: number;
  /** 例外・反例を、発話の根拠つきで挙げた仮説 */
  withCounterEvidence: number;
  /** 例外・反例の欄に「見当たらない」などの文だけがある仮説 */
  withCounterNoteOnly: number;
  /** 例外・反例の欄が空の仮説 */
  withoutCounter: number;
  /** 根拠が 2 回以上の面談にまたがる仮説 */
  acrossInterviews: number;
  byConfidence: Record<string, number>;
};

export function summarizeHypotheses(hs: Hypothesis[]): HypothesisSummary {
  const byConfidence: Record<string, number> = {};
  for (const h of hs) byConfidence[h.confidence ?? "（読めない）"] = (byConfidence[h.confidence ?? "（読めない）"] ?? 0) + 1;
  return {
    total: hs.length,
    withCounterEvidence: hs.filter((h) => h.counter.length > 0).length,
    withCounterNoteOnly: hs.filter((h) => h.counter.length === 0 && h.counterNote !== "").length,
    withoutCounter: hs.filter((h) => h.counter.length === 0 && h.counterNote === "").length,
    acrossInterviews: hs.filter((h) => h.interviews.length >= 2).length,
    byConfidence,
  };
}

/** 根拠が指す発話の数（重なりを除く）。根拠の数は、独立した証拠の数ではない */
export function uniqueUtterances(refs: EvidenceRef[]): number {
  const seen = new Set<string>();
  for (const r of refs) for (let i = r.index; i <= r.lastIndex; i++) seen.add(`${r.interviewId}#${i}`);
  return seen.size;
}

/** 根拠と反例の両方に挙げられた発話。同じ発話は、その仮説の反例にならない */
export function counterOverlaps(h: Pick<Hypothesis, "evidence" | "counter">): string[] {
  const inEvidence = new Set<string>();
  for (const r of h.evidence) for (let i = r.index; i <= r.lastIndex; i++) inEvidence.add(`${r.interviewId} 発話 ${i}`);
  const out = new Set<string>();
  for (const r of h.counter) for (let i = r.index; i <= r.lastIndex; i++) if (inEvidence.has(`${r.interviewId} 発話 ${i}`)) out.add(`${r.interviewId} 発話 ${i}`);
  return [...out];
}

/** 発話の本文の行（「>」と根拠の行）と「」の中を除いた、夢自身の文 */
function ownWords(markdown: string): { line: number; text: string }[] {
  return markdown
    .split("\n")
    .map((l, i) => ({ line: i + 1, text: l }))
    .filter((l) => !/^\s*>/.test(l.text))
    .map((l) => ({ line: l.line, text: l.text.replace(/〔[^〕]*〕[^「]*「.*」/g, "").replace(/「[^」]*」/g, "") }));
}

const CAUSAL = /したから|すると|したことで|効いた|効果|有効|につながっ|引き出し/gu;
const VERIFICATION_CLAIM = /照合済|一字照合|検証済|確認済/gu;

export type TextHit = { line: number; word: string; text: string };

function findHits(markdown: string, re: RegExp): TextHit[] {
  const out: TextHit[] = [];
  for (const l of ownWords(markdown)) for (const m of l.text.matchAll(re)) out.push({ line: l.line, word: m[0], text: l.text.trim().slice(0, 80) });
  return out;
}

/** 発話が続いたという観察から、原因を言い切る言い方の候補。当たれば人が読む（当たらなくても、因果を言っていないとは限らない） */
export const causalHits = (markdown: string): TextHit[] => findHits(markdown, CAUSAL);

/** 夢が「照合した」と自分で書いた所。照合したのはアプリなので、この言葉は信じない */
export const verificationClaims = (markdown: string): TextHit[] => findHits(markdown, VERIFICATION_CLAIM);
