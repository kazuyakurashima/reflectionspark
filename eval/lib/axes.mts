// 評価の軸（docs/設計書.md「評価で見ること」の軸 1〜12）をプログラムで計算する部品。
// 軸は 1 つの点にまとめず、別々に返す。LLM 判定（軸 3・4・10、12 の推測の意味）は judge.mts。
// 軸 12 の 0c：「抜け」（言葉が抜けていて推測できないと答えた所）は推測とは別に数え、LLM 判定に回さない（needsMeaningJudge）。
// 「主な数字は作り手が確かめた所だけで出す」：正解の範囲は source（作り手／決め／案）で分けて持ち、
// 〔案〕の結果は別の欄に出す。

import { looseKey } from "../../engine/text.mts";
import { quoteMatchesTranscript } from "../../engine/citations.mts";
import { scanObject } from "../../engine/forbidden-words.mts";
import type { ForbiddenHit } from "../../engine/forbidden-words.mts";
import type {
  ItemScore,
  Quote,
  Scene,
  Step0bResult,
  Step0cResult,
  Step1Result,
  Step2Result,
  Step3Result,
  Step4Result,
  Transcript,
  Utterance,
} from "../../engine/types.mts";
import { linesForMemoSpan, mismatchSpots, scriptWindowForMemoSpan } from "./align.mts";
import type { Alignment, ScriptLine } from "./align.mts";
import { expandLines, isVerified } from "./truth.mts";
import type { Range, Truth } from "./truth.mts";

// ---------- 共通 ----------

/** 発話番号 → 台本の行（重なった文字数が多い順）。対応が無ければ空。 */
export function linesOfUtterance(u: Utterance, a: Alignment): { line: number; chars: number }[] {
  if (!u.memoSpan) return [];
  return linesForMemoSpan(a, u.memoSpan[0], u.memoSpan[1]);
}

/** 引用が指す発話番号の並び。複数の発話にまたがる引用は、終わりの発話まで数える */
export function quoteIndices(q: Pick<Quote, "index" | "endIndex">): number[] {
  const end = Number.isInteger(q.endIndex) && q.endIndex > q.index ? q.endIndex : q.index + 1;
  return Array.from({ length: end - q.index }, (_, i) => q.index + i);
}

/** 発話番号の並び → 台本の行の集合 */
export function linesOfUtterances(indices: number[], t: Transcript, a: Alignment): number[] {
  const set = new Set<number>();
  for (const i of indices) {
    const u = t.utterances[i];
    if (!u) continue;
    for (const { line } of linesOfUtterance(u, a)) set.add(line);
  }
  return [...set].sort((x, y) => x - y);
}

/**
 * 正解の範囲から、文字起こしに無い行を除く。
 * 返す lines が null なら「範囲なし」（面談全体）。absent が true なら、範囲の行がすべて文字起こしに無い（分母から外す）。
 */
export function truthLines(r: Range, a: Alignment): { lines: number[] | null; dropped: number[]; absent: boolean } {
  const all = expandLines(r.lines);
  if (all === null) return { lines: null, dropped: [], absent: false };
  const missing = new Set(a.missingLines);
  const lines = all.filter((l) => !missing.has(l));
  const dropped = all.filter((l) => missing.has(l));
  return { lines, dropped, absent: lines.length === 0 && all.length > 0 };
}

export function overlaps(aLines: number[], bLines: number[] | null): boolean {
  if (bLines === null) return true;
  const s = new Set(bLines);
  return aLines.some((l) => s.has(l));
}

// ---------- 軸 1：引用の原文一致 ----------

export type Axis1 = {
  generated: number;
  discarded: number;
  displayed: number;
  /** 表示した引用のうち原文と一致した数（照合で捨てた後なので、displayed と同じになるはず） */
  displayedVerified: number;
  displayedMatchRate: number | null;
  scenesWithoutQuote: number;
  /** 文脈の一行に解釈や評価の言葉が入っていた場面 */
  contextWithJudgement: { type: string; context: string; words: string[] }[];
  /** 前後の相手の発話が本当に隣り合っているか（アプリが発話番号から取るので、取れなかった数） */
  neighborsMissing: number;
};

const JUDGEMENT_WORDS = ["よい", "良い", "悪い", "うまく", "上手", "下手", "失敗", "成功", "適切", "不適切", "惜しい", "残念", "すばらしい", "素晴らしい", "甘い", "厳しすぎ", "足りない", "不足", "十分", "効果的", "もったいない"];

/** 文脈の一行（事実だけ）に、評価の言葉が入っていないか（決まり 2） */
export function judgementWordsIn(text: string): string[] {
  return JUDGEMENT_WORDS.filter((w) => text.includes(w));
}

export function axis1(step1: Step1Result, t: Transcript): Axis1 {
  const scenes = step1.scenes;
  const displayed = scenes.reduce((s, sc) => s + sc.quotes.length, 0);
  const displayedVerified = scenes.reduce((s, sc) => s + sc.quotes.filter((q) => quoteMatchesTranscript(q, t.utterances)).length, 0);
  let neighborsMissing = 0;
  for (const sc of scenes) {
    for (const q of sc.quotes) {
      // 直前と直後の相手の発話。面談の先頭・末尾は無くてよい
      if (q.index > 0 && !t.utterances[q.index - 1]) neighborsMissing++;
      if (q.index < t.utterances.length - 1 && !t.utterances[q.index + 1]) neighborsMissing++;
    }
  }
  return {
    generated: step1.quoteStats.generated,
    discarded: step1.quoteStats.discarded,
    displayed,
    displayedVerified,
    displayedMatchRate: displayed === 0 ? null : displayedVerified / displayed,
    scenesWithoutQuote: step1.quoteStats.scenesWithoutQuote,
    contextWithJudgement: scenes
      .map((sc) => ({ type: sc.type, context: sc.context, words: judgementWordsIn(sc.context) }))
      .filter((x) => x.words.length > 0),
    neighborsMissing,
  };
}

// ---------- 軸 2：鍵の場面の再現 ----------

export type SceneMatch = {
  truthName: string;
  source: string;
  verified: boolean;
  truthLines: number[] | null;
  droppedLines: number[];
  /** 正解の行がすべて文字起こしに無い（分母から外す） */
  absent: boolean;
  matched: boolean | null;
};

export type Axis2 = {
  /** AI の場面ごとに、引用の発話番号と台本の行 */
  aiScenes: { type: string; items: number[]; utterances: number[]; lines: number[] }[];
  /** よく表れた所 ↔ 強み（いちばん・次点）、次に試せる所 ↔ 課題（いちばん・次点） */
  scenes: SceneMatch[];
  /** 山場の検査（記録だけ） */
  climax: { watch: string; matched: boolean | null } | null;
  /** 項目ごと：AI がその項目を関わる項目として付けた場面が、正解の範囲（よく／まずく）と重なるか */
  items: { item: number; mark: string; good: SceneMatch | null; bad: SceneMatch | null }[];
};

function sceneLines(sc: Scene, t: Transcript, a: Alignment): { utterances: number[]; lines: number[] } {
  const utterances = sc.quotes.flatMap(quoteIndices);
  return { utterances, lines: linesOfUtterances(utterances, t, a) };
}

function matchScene(name: string, r: Range | null, aiLines: number[], a: Alignment): SceneMatch | null {
  if (!r) return null;
  const tl = truthLines(r, a);
  return {
    truthName: name,
    source: r.source,
    verified: isVerified(r.source),
    truthLines: tl.lines,
    droppedLines: tl.dropped,
    absent: tl.absent,
    matched: tl.absent ? null : overlaps(aiLines, tl.lines),
  };
}

export function axis2(step1: Step1Result, truth: Truth, t: Transcript, a: Alignment): Axis2 {
  const aiScenes = step1.scenes.map((sc) => ({ type: sc.type, items: sc.items, ...sceneLines(sc, t, a) }));
  const good = aiScenes.filter((s) => s.type === "よく表れた所").flatMap((s) => s.lines);
  const bad = aiScenes.filter((s) => s.type === "次に試せる所").flatMap((s) => s.lines);
  const scenes = [
    matchScene("強み・いちばん", truth.scenes.strengthBest, good, a),
    matchScene("強み・次点", truth.scenes.strengthNext, good, a),
    matchScene("課題・いちばん", truth.scenes.issueBest, bad, a),
    matchScene("課題・次点", truth.scenes.issueNext, bad, a),
  ].filter((x): x is SceneMatch => x !== null);
  const climax = truth.climax
    ? {
        watch: truth.climax.watch,
        matched: scenes.find((s) => s.truthName === (truth.climax!.watch === "issueBest" ? "課題・いちばん" : "強み・いちばん"))?.matched ?? null,
      }
    : null;
  const items = ([1, 2, 3, 4, 5] as const).map((n) => {
    const it = truth.items[String(n) as "1"];
    const withItem = aiScenes.filter((s) => s.items.includes(n));
    const goodLines = withItem.filter((s) => s.type === "よく表れた所").flatMap((s) => s.lines);
    const badLines = withItem.filter((s) => s.type === "次に試せる所").flatMap((s) => s.lines);
    return {
      item: n,
      mark: it.mark,
      good: matchScene(`項目 ${n} よく`, it.good, goodLines, a),
      bad: matchScene(`項目 ${n} まずく`, it.bad, badLines, a),
    };
  });
  return { aiScenes, scenes, climax, items };
}

// ---------- 軸 5：性質の言葉の不在と点の置き場所 ----------

export type Axis5 = {
  /** 出力の文に残っていた性質の言葉（本番の検査をすり抜けたもの。0 のはず） */
  hits: ForbiddenHit[];
  /** 本番の検査（engine/guard.mts）が表示を控えた欄。評価ではこれも「性質の言葉が出た数」に数える */
  withheld: { step: string; field: string; words: string[]; original: string }[];
  /** 原文に無くて「」を外した言葉の数 */
  unverifiedQuotes: number;
  /** 工程 1 の本文に点が混ざっていないか（点は工程 2 で別に出す） */
  scoresInStep1: boolean;
  /** 工程 2 の点が 5 項目ごとに出ているか */
  scoresPerItem: boolean;
};

export function axis5(step1: Step1Result | null, step2: Step2Result | null, step3: Step3Result | null, step4: Step4Result | null): Axis5 {
  const hits: ForbiddenHit[] = [];
  if (step1) hits.push(...scanObject({ scenes: step1.scenes, summary: step1.summary, flow: step1.flow, extraQuestion: step1.extraQuestion, noScene: step1.noScene }, undefined, "step1"));
  if (step2) hits.push(...scanObject({ items: step2.items, ethics: step2.ethics }, undefined, "step2"));
  if (step3) hits.push(...scanObject({ candidates: step3.candidates }, undefined, "step3"));
  if (step4) hits.push(...scanObject({ verdict: step4.verdict, why: step4.why, items: step4.items, otherPersonLine: step4.otherPersonLine }, undefined, "step4"));
  const scoresInStep1 = step1 ? /[0-9０-９]\s*点|採点|\b[0-9]\s*\/\s*[0-9]/.test(step1.rawText) : false;
  const scoresPerItem = step2 ? [1, 2, 3, 4, 5].every((n) => step2.items.some((i) => i.item === n)) : false;
  const withheld: Axis5["withheld"] = [];
  const uq = { n: 0 };
  for (const [step, r] of [["step1", step1], ["step2", step2], ["step3", step3], ["step4", step4]] as const) {
    if (!r) continue;
    for (const w of r.withheld ?? []) withheld.push({ step, ...w });
    uq.n += (r.unverifiedQuotes ?? []).length;
  }
  return { hits, withheld, unverifiedQuotes: uq.n, scoresInStep1, scoresPerItem };
}

// ---------- 軸 6：次回の追跡 ----------

export type Axis6 = {
  truthVerdict: string;
  aiVerdict: string;
  matched: boolean;
  truthEvidenceLines: number[] | null;
  aiEvidenceLines: number[];
  evidenceOverlaps: boolean | null;
  source: string;
};

export function axis6(step4: Step4Result, truth: Truth, t: Transcript, a: Alignment): Axis6 | null {
  if (!truth.followUp) return null;
  const tl = truthLines({ lines: truth.followUp.evidenceLines, source: truth.followUp.source }, a);
  const aiEvidenceLines = linesOfUtterances(step4.quotes.flatMap(quoteIndices), t, a);
  return {
    truthVerdict: truth.followUp.verdict,
    aiVerdict: step4.verdict,
    matched: truth.followUp.verdict === step4.verdict,
    truthEvidenceLines: tl.lines,
    aiEvidenceLines,
    evidenceOverlaps: tl.absent ? null : overlaps(aiEvidenceLines, tl.lines),
    source: truth.followUp.source,
  };
}

// ---------- 軸 8：保留の正しさ ----------

export type Axis8 = {
  firstMeeting: boolean;
  item5Withheld: boolean | null;
  /** 正解で「判定しない」の項目を AI も判定しなかったか */
  withheldAsTruth: { item: number; truth: boolean; ai: boolean }[];
  /** 根拠のある場面が無いのが正解か（ひっかけ用） */
  truthNoScene: boolean;
  /** 根拠のある場面が無いと AI が言ったか（ひっかけ用） */
  saidNoScene: boolean;
};

export function axis8(step1: Step1Result | null, step2: Step2Result, truth: Truth): Axis8 {
  const withheldAsTruth = ([1, 2, 3, 4, 5] as const).map((n) => ({
    item: n,
    truth: truth.items[String(n) as "1"].mark === "判定しない",
    ai: step2.items.find((i) => i.item === n)?.score === null,
  }));
  return {
    firstMeeting: truth.firstMeeting,
    item5Withheld: truth.firstMeeting ? step2.items.find((i) => i.item === 5)?.score === null : null,
    withheldAsTruth,
    truthNoScene: truth.noScene !== undefined,
    saidNoScene: step1 ? step1.noScene !== null : false,
  };
}

// ---------- 軸 9：点の向き ----------

export type Axis9 = {
  /** 正解が ○ だけの項目と × だけの項目の組（作り手が確かめた所だけ。範囲が文字起こしに無い項目は除く） */
  pairs: { good: number; bad: number; goodScore: number | null; badScore: number | null; ok: boolean | null }[];
  satisfied: number;
  countable: number;
  /** 〔案〕の範囲しか無い項目を含めた組（参考） */
  pairsIncludingDraft: number;
  /** 正解の範囲がすべて文字起こしに無く、分母から外した項目（「文字起こしに無い行」） */
  absentItems: number[];
};

export function axis9(items: ItemScore[], truth: Truth, a: Alignment | null = null): Axis9 {
  const score = (n: number) => items.find((i) => i.item === n)?.score ?? null;
  const goods: number[] = [];
  const bads: number[] = [];
  const goodsAll: number[] = [];
  const badsAll: number[] = [];
  const absentItems: number[] = [];
  const absent = (r: Range | null) => (r && a ? truthLines(r, a).absent : false);
  for (const n of [1, 2, 3, 4, 5]) {
    const it = truth.items[String(n) as "1"];
    if (it.mark === "○") {
      if (absent(it.good)) {
        absentItems.push(n);
        continue;
      }
      goodsAll.push(n);
      if (!it.good || isVerified(it.good.source)) goods.push(n);
    }
    if (it.mark === "×") {
      if (absent(it.bad)) {
        absentItems.push(n);
        continue;
      }
      badsAll.push(n);
      if (!it.bad || isVerified(it.bad.source)) bads.push(n);
    }
  }
  const pairs = goods.flatMap((g) =>
    bads.map((b) => {
      const gs = score(g);
      const bs = score(b);
      return { good: g, bad: b, goodScore: gs, badScore: bs, ok: gs === null || bs === null ? null : gs > bs };
    }),
  );
  const countable = pairs.filter((p) => p.ok !== null).length;
  return {
    pairs,
    satisfied: pairs.filter((p) => p.ok === true).length,
    countable,
    pairsIncludingDraft: goodsAll.length * badsAll.length,
    absentItems,
  };
}

// ---------- 軸 11：工程 0a の話者 ----------

export type Axis11 = {
  utterances: number;
  /** 台本の行に対応した発話の数（分母） */
  aligned: number;
  correct: number;
  accuracy: number | null;
  /** 確からしさごとの数と誤り */
  byConfidence: { confidence: string; count: number; wrong: number }[];
  /** 1 発話が 2 行以上（話者が違う）にまたがった数（区切りのずれ） */
  spanningSpeakers: number;
  /** 相手が 2 人以上と推定したか（この評価では false が正しい） */
  multipleOthers: boolean;
  wrong: { index: number; ai: string; truth: string; confidence: string; text: string }[];
};

export function axis11(t: Transcript, a: Alignment, script: ScriptLine[]): Axis11 {
  const speakerOf = new Map(script.map((l) => [l.line, l.speaker]));
  let aligned = 0;
  let correct = 0;
  let spanningSpeakers = 0;
  const byConf = new Map<string, { count: number; wrong: number }>();
  const wrong: Axis11["wrong"] = [];
  for (const u of t.utterances) {
    const lines = linesOfUtterance(u, a);
    const c = byConf.get(u.confidence) ?? { count: 0, wrong: 0 };
    c.count++;
    byConf.set(u.confidence, c);
    if (lines.length === 0) continue;
    aligned++;
    const speakers = new Set(lines.map((l) => speakerOf.get(l.line)));
    if (speakers.size > 1) spanningSpeakers++;
    const truthSpeaker = speakerOf.get(lines[0].line) ?? "?";
    if (truthSpeaker === u.speaker) correct++;
    else {
      c.wrong++;
      wrong.push({ index: u.index, ai: u.speaker, truth: truthSpeaker, confidence: u.confidence, text: u.original.slice(0, 40) });
    }
  }
  return {
    utterances: t.utterances.length,
    aligned,
    correct,
    accuracy: aligned === 0 ? null : correct / aligned,
    byConfidence: ["高", "中", "低"].map((k) => ({ confidence: k, count: byConf.get(k)?.count ?? 0, wrong: byConf.get(k)?.wrong ?? 0 })),
    spanningSpeakers,
    multipleOthers: t.multipleOthers,
    wrong,
  };
}

// ---------- 軸 12：工程 0b・0c の直しと推測 ----------

export type CorrectionJudgement = {
  index: number;
  kind: string;
  before: string;
  after: string;
  /** 拾えた（台本と合った）／直しすぎ：元が正しかった／直しすぎ：場所は合うが言った言葉と違う／台本に対応なし */
  verdict: "拾えた" | "元が正しかった" | "言った言葉と違う" | "対応なし";
  /** 直す前の言葉に対応する、台本の位置そのものの文字（正規化後） */
  scriptWindow: string | null;
};

export type Axis12 = {
  corrections: CorrectionJudgement[];
  applied: number;
  discarded: number;
  picked: number;
  overfixedOriginalCorrect: number;
  overfixedWrongWord: number;
  unaligned: number;
  pickedByKind: Record<string, number>;
  /** 台本と食い違う所（聞き違い）の数と、そのうち直しで触れた数 */
  mismatchSpots: number;
  mismatchTouched: number;
  missed: { line: number; memoText: string }[];
  guesses: GuessJudgement[];
  /** 推測（「崩れ」「話者の取り違え」）の数。「抜け」は入れない */
  guessStats: { total: number; reallyBroken: number; guessMatchesScript: number; changedCorrect: number; unaligned: number };
  /** 「抜け」と答えた所。reallyMissing は、その所の前後で台本の文字が文字起こしに GAP_MIN_CHARS 字以上続けて無い数。unaligned は台本との対応が取れなかった数 */
  gapStats: { total: number; reallyMissing: number; unaligned: number };
};

/** 「抜け」を「台本で言葉が落ちていた」と数える、続けて無い台本の文字数の下限（1 字は助詞の揺れや対応付けのずれで出るので数えない） */
export const GAP_MIN_CHARS = 2;

export type GuessJudgement = {
  index: number;
  kind: string;
  fragment: string;
  guess: string;
  reallyBroken: boolean | null;
  guessMatchesScript: boolean | null;
  /** 正しい発話に推測を付けて意味を変えた（断片は台本と合っていたのに推測が違う） */
  changedCorrect: boolean;
  scriptWindow: string | null;
  /** 「抜け」だけ：抜けと見た所の前後で、台本の文字が文字起こしに続けて無い数（いちばん大きい飛び。文字起こしに無い行の文字も数える）。対応が取れなければ null */
  gapChars: number | null;
};

/** 軸 12 の推測の意味の判定（LLM）に回すか。「崩れ」で台本の対応がある所だけ。「抜け」と「話者の取り違え」は回さない */
export function needsMeaningJudge(g: Pick<GuessJudgement, "kind" | "scriptWindow">): boolean {
  return g.kind === "崩れ" && g.scriptWindow !== null;
}

/**
 * ボイスメモの範囲 [start, end)（元の文字列の位置）の前後 1 字を含めて、対応した台本の文字の添字を順に並べ、
 * 隣どうしの飛び（間にある、文字起こしに無い台本の文字の数）のいちばん大きいものを返す。
 * 文字起こしに無い行の文字は対応なしなので、行ごと落ちた所もこの飛びに入る。対応した文字が無ければ null。
 */
export function missingScriptCharsAround(a: Alignment, start: number, end: number): number | null {
  const idx = a.memo.index;
  let k0 = 0;
  while (k0 < idx.length && idx[k0] < start) k0++;
  let k1 = k0;
  while (k1 < idx.length && idx[k1] < end) k1++;
  const from = Math.max(0, k0 - 1);
  const to = Math.min(idx.length, k1 + 1);
  let prev = -1;
  let found = false;
  let max = 0;
  for (let k = from; k < to; k++) {
    const si = a.memoCharScript[k];
    if (si < 0) continue;
    if (prev >= 0 && si > prev) max = Math.max(max, si - prev - 1);
    prev = si;
    found = true;
  }
  return found ? max : null;
}

/** 発話の中の断片の、元の文字起こしでの範囲 [start, end) を返す */
function spanOfFragment(u: Utterance, fragment: string): [number, number] | null {
  if (!u.memoSpan) return null;
  const orig = [...u.original];
  const frag = [...fragment];
  // 元の文の中を探す（元の文は直しを当てる前なので、2 件目の直しは当て終わった文に対して書かれていることがある）
  const origStr = orig.join("");
  let pos = origStr.indexOf(fragment);
  if (pos >= 0) {
    const cp = [...origStr.slice(0, pos)].length;
    return [u.memoSpan[0] + cp, u.memoSpan[0] + cp + frag.length];
  }
  // 当てた後の本文にあれば、その位置を元の文の位置とみなす（長さの違いは無視）
  if (u.text) {
    pos = u.text.indexOf(fragment);
    if (pos >= 0) {
      const cp = Math.min([...u.text.slice(0, pos)].length, orig.length);
      return [u.memoSpan[0] + cp, Math.min(u.memoSpan[1], u.memoSpan[0] + cp + frag.length)];
    }
  }
  return null;
}

/** 直した言葉を、対応する台本の位置そのもの（前後に広げない）の文字と、正規化の後で完全一致で比べる */
function sameAsScript(slice: string[] | null, text: string): boolean | null {
  if (!slice) return null;
  const key = looseKey(text);
  if (key === "") return null;
  return slice.join("") === key;
}

function spotsIn(spots: { start: number; end: number }[], start: number, end: number): number {
  return spots.filter((s) => s.start < end && s.end > start).length;
}

export function axis12(t: Transcript, a: Alignment): Axis12 {
  const spots = mismatchSpots(a);
  const touched = new Set<number>();
  const corrections: CorrectionJudgement[] = [];
  const pickedByKind: Record<string, number> = {};
  for (const c of t.step0b.applied) {
    const u = t.utterances[c.index];
    const span = u ? spanOfFragment(u, c.before) : null;
    const win = span ? scriptWindowForMemoSpan(a, span[0], span[1], 0) : null;
    let verdict: CorrectionJudgement["verdict"];
    if (!win) verdict = "対応なし";
    else if (sameAsScript(win.chars, c.after)) {
      verdict = "拾えた";
      pickedByKind[c.kind] = (pickedByKind[c.kind] ?? 0) + 1;
    } else if (sameAsScript(win.chars, c.before)) verdict = "元が正しかった";
    else verdict = "言った言葉と違う";
    if (span) spots.forEach((s, i) => s.start < span[1] && s.end > span[0] && touched.add(i));
    corrections.push({ index: c.index, kind: c.kind, before: c.before, after: c.after, verdict, scriptWindow: win ? win.chars.join("") : null });
  }
  const guesses: GuessJudgement[] = [];
  const g0c: Step0cResult | null = t.step0c;
  for (const g of g0c?.guesses ?? []) {
    const u = t.utterances[g.index];
    const span = u ? spanOfFragment(u, g.fragment) : null;
    const win = span ? scriptWindowForMemoSpan(a, span[0], span[1], 0) : null;
    const gap = g.kind === "抜け";
    // 「抜け」は推測ではないので、崩れていたか・推測が合うかは見ず、その所で台本の言葉が落ちているかだけを見る
    const reallyBroken = gap || !span ? null : spotsIn(spots, span[0], span[1]) > 0;
    const fragmentInScript = sameAsScript(win?.chars ?? null, g.fragment);
    const guessMatchesScript = g.kind === "崩れ" ? sameAsScript(win?.chars ?? null, g.guess) : null;
    guesses.push({
      index: g.index,
      kind: g.kind,
      fragment: g.fragment,
      guess: g.guess,
      reallyBroken,
      guessMatchesScript,
      changedCorrect: g.kind === "崩れ" && fragmentInScript === true && guessMatchesScript === false,
      scriptWindow: win ? win.chars.join("") : null,
      gapChars: gap && span ? missingScriptCharsAround(a, span[0], span[1]) : null,
    });
  }
  const judged = guesses.filter((g) => g.kind !== "抜け");
  const gaps = guesses.filter((g) => g.kind === "抜け");
  const missed = spots.filter((_, i) => !touched.has(i)).map((s) => ({ line: s.line, memoText: s.memoText }));
  return {
    corrections,
    applied: t.step0b.applied.length,
    discarded: t.step0b.discarded.length,
    picked: corrections.filter((c) => c.verdict === "拾えた").length,
    overfixedOriginalCorrect: corrections.filter((c) => c.verdict === "元が正しかった").length,
    overfixedWrongWord: corrections.filter((c) => c.verdict === "言った言葉と違う").length,
    unaligned: corrections.filter((c) => c.verdict === "対応なし").length,
    pickedByKind,
    mismatchSpots: spots.length,
    mismatchTouched: touched.size,
    missed,
    guesses,
    guessStats: {
      total: judged.length,
      reallyBroken: judged.filter((g) => g.reallyBroken === true).length,
      guessMatchesScript: judged.filter((g) => g.guessMatchesScript === true).length,
      changedCorrect: judged.filter((g) => g.changedCorrect).length,
      unaligned: judged.filter((g) => g.reallyBroken === null).length,
    },
    gapStats: {
      total: gaps.length,
      reallyMissing: gaps.filter((g) => g.gapChars !== null && g.gapChars >= GAP_MIN_CHARS).length,
      unaligned: gaps.filter((g) => g.gapChars === null).length,
    },
  };
}

// ---------- 整形の揺れ ----------

export type Step0Variance = {
  runs: number;
  utteranceCounts: number[];
  speakerDisagreements: number | null;
  correctionCounts: number[];
  correctionsCommonToAll: number;
  guessCounts: number[];
  guessesCommonToAll: number;
  confidenceCounts: Record<string, number>[];
};

/** 同じ入力で工程 0 を数回回した結果の揺れ。話者は、発話の区切りが同じときだけ比べる。 */
export function step0Variance(runs: Transcript[]): Step0Variance {
  const key = (b: Step0bResult["applied"][number]) => `${b.before}→${b.after}`;
  const gkey = (g: { fragment: string; guess: string }) => `${g.fragment}→${g.guess}`;
  const sameSplit = runs.every((r) => r.utterances.length === runs[0].utterances.length);
  let speakerDisagreements: number | null = null;
  if (sameSplit) {
    speakerDisagreements = 0;
    for (let i = 0; i < runs[0].utterances.length; i++) {
      const s = new Set(runs.map((r) => r.utterances[i].speaker));
      if (s.size > 1) speakerDisagreements++;
    }
  }
  const corrSets = runs.map((r) => new Set(r.step0b.applied.map(key)));
  const guessSets = runs.map((r) => new Set((r.step0c?.guesses ?? []).map(gkey)));
  const common = (sets: Set<string>[]) => [...sets[0]].filter((k) => sets.every((s) => s.has(k))).length;
  return {
    runs: runs.length,
    utteranceCounts: runs.map((r) => r.utterances.length),
    speakerDisagreements,
    correctionCounts: runs.map((r) => r.step0b.applied.length),
    correctionsCommonToAll: common(corrSets),
    guessCounts: runs.map((r) => r.step0c?.guesses.length ?? 0),
    guessesCommonToAll: common(guessSets),
    confidenceCounts: runs.map((r) => {
      const c: Record<string, number> = { 高: 0, 中: 0, 低: 0 };
      for (const u of r.utterances) c[u.confidence] = (c[u.confidence] ?? 0) + 1;
      return c;
    }),
  };
}
