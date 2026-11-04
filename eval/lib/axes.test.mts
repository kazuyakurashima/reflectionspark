import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Step1Result, Step2Result, Transcript } from "../../engine/types.mts";
import { alignScriptToMemo, parseScript } from "./align.mts";
import { axis1, axis11, axis12, axis2, axis5, axis6, axis8, axis9, judgementWordsIn, quoteIndices, step0Variance, truthLines } from "./axes.mts";
import type { Truth } from "./truth.mts";

const script = parseScript(
  [
    "講師：じゃあ、始めようか。今日、部活は？",
    "生徒：今日は早めに終わりました。顧問の先生が出張で。",
    "講師：そっか。吹奏楽、来月が最後のコンクールだっけ。",
    "生徒：はい。それで引退です。",
    "講師：会場はどこ？",
    "生徒：市民会館です。お母さんも聞きに来るって言ってました。",
  ].join("\n"),
);
// 2 行目の「顧問」が「古文」に聞き違えられ、4 行目の「はい」が落ちた
const memo = "じゃあ始めようか。今日部活は。今日は早めに終わりました。古文の先生が出張で。そっか、吹奏楽来月が最後のコンクールだっけ。会場はどこ市民会館です。お母さんも聞きに来るって言ってました。";
const a = alignScriptToMemo(script, memo);
const cp = (s: string) => [...s].length;
const spanOf = (text: string): [number, number] => {
  const i = cp(memo.slice(0, memo.indexOf(text)));
  return [i, i + cp(text)];
};

function utter(index: number, speaker: string, original: string, confidence: "高" | "中" | "低" = "高") {
  return { index, speaker, text: original, original, confidence, check: [], memoSpan: spanOf(original) };
}

const transcript: Transcript = {
  kind: "生徒",
  raw: memo,
  multipleOthers: false,
  utterances: [
    utter(0, "講師", "じゃあ始めようか。今日部活は。"),
    utter(1, "生徒", "今日は早めに終わりました。古文の先生が出張で。"),
    utter(2, "講師", "そっか、吹奏楽来月が最後のコンクールだっけ。"),
    utter(3, "生徒", "会場はどこ", "低"), // 本当は講師
    utter(4, "生徒", "市民会館です。お母さんも聞きに来るって言ってました。"),
  ],
  step0b: {
    proposed: [],
    applied: [
      { index: 1, kind: "同音の取り違え", before: "古文", after: "顧問" },
      { index: 2, kind: "助詞や語尾の聞き違え", before: "だっけ", after: "だよね" },
    ],
    discarded: [],
  },
  step0c: { summary: "進路の面談。", guesses: [{ index: 1, kind: "崩れ", fragment: "古文の先生", guess: "顧問の先生", clue: "部活の話" }] },
};
transcript.utterances[1].text = "今日は早めに終わりました。顧問の先生が出張で。";

const truth: Truth = {
  case: "t",
  version: "v1",
  kind: "生徒",
  title: "t",
  firstMeeting: true,
  scenes: {
    strengthBest: { lines: [3], source: "作り手" },
    strengthNext: { lines: [4], source: "案" },
    issueBest: { lines: "5-6", source: "作り手" },
    issueNext: null,
  },
  items: {
    "1": { mark: "○", good: { lines: [3], source: "作り手" }, bad: null },
    "2": { mark: "×", good: null, bad: { lines: [5], source: "作り手" } },
    "3": { mark: "×", good: null, bad: { lines: [1], source: "案" } },
    "4": { mark: "○×", good: { lines: [1], source: "作り手" }, bad: { lines: [2], source: "作り手" } },
    "5": { mark: "判定しない", good: null, bad: null },
  },
  climax: { watch: "issueBest", note: "" },
};

const step1: Step1Result = {
  scenes: [
    {
      type: "よく表れた所",
      items: [1],
      context: "講師が部活の話を聞いた。",
      quotes: [{ citedText: "講師：そっか、吹奏楽来月が最後のコンクールだっけ。", text: "そっか、吹奏楽来月が最後のコンクールだっけ。", index: 2, endIndex: 3, verified: true }],
      discardedQuotes: [],
      quotedTextInBody: "",
      observation: "",
      reaction: "",
      reading: "",
      asChoice: null,
      question: "",
      record: { whyChosen: "", runnerUp: [] },
    },
    {
      type: "次に試せる所",
      items: [2],
      context: "会場を聞いた所。うまくなかった。",
      quotes: [{ citedText: "生徒：会場はどこ", text: "会場はどこ", index: 3, endIndex: 4, verified: true }],
      discardedQuotes: [{ citedText: "生徒：会場は", text: "", index: 3, endIndex: 4, verified: false }],
      quotedTextInBody: "",
      observation: "",
      reaction: "",
      reading: "講師は話しすぎる傾向がある。",
      asChoice: null,
      question: "",
      record: { whyChosen: "", runnerUp: [] },
    },
  ],
  noScene: null,
  summary: "",
  flow: [],
  extraQuestion: null,
  quoteStats: { generated: 3, discarded: 1, scenesWithoutQuote: 0 },
  firstCitationMs: 100,
  rawText: "",
  meta: { model: "m", ms: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  withheld: [{ field: "scenes[1].observation", words: ["癖"], original: "説明を足す癖がある。" }],
  unverifiedQuotes: [],
};

const step2: Step2Result = {
  items: [
    { item: 1, score: 4, reason: "", utterances: [2] },
    { item: 2, score: 2, reason: "", utterances: [3] },
    { item: 3, score: 3, reason: "", utterances: [] },
    { item: 4, score: 3, reason: "", utterances: [] },
    { item: 5, score: null, reason: "初回", utterances: [] },
  ],
  total: { sum: 12, judgedCount: 4, max: 20, scaled: 6 },
  insightOwner: "講師",
  ethics: { level: "問題なし", text: "", viewpoint: null, utterances: [] },
  meta: { model: "m", ms: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  withheld: [],
  unverifiedQuotes: [],
};

describe("軸の計算", () => {
  test("軸 1：生成・捨てた・表示した引用の数を分けて残す", () => {
    const r = axis1(step1, transcript);
    assert.equal(r.generated, 3);
    assert.equal(r.discarded, 1);
    assert.equal(r.displayed, 2);
    assert.equal(r.displayedMatchRate, 1);
    assert.equal(r.contextWithJudgement.length, 1);
    assert.deepEqual(judgementWordsIn("講師が部活の話を聞いた。"), []);
  });

  test("文字起こしに無い行を正解の範囲から除く。全部無ければ「入力に無い」", () => {
    assert.deepEqual(truthLines({ lines: [3, 4], source: "作り手" }, a), { lines: [3], dropped: [4], absent: false });
    assert.equal(truthLines({ lines: [4], source: "作り手" }, a).absent, true);
    assert.equal(truthLines({ lines: null, source: "作り手" }, a).lines, null);
  });

  test("軸 2：AI の場面の引用を台本の行に写し、正解と重なるかを見る。〔案〕は分ける", () => {
    const r = axis2(step1, truth, transcript, a);
    const best = r.scenes.find((s) => s.truthName === "強み・いちばん")!;
    assert.equal(best.matched, true);
    assert.equal(best.verified, true);
    const next = r.scenes.find((s) => s.truthName === "強み・次点")!;
    assert.equal(next.absent, true);
    assert.equal(next.matched, null);
    assert.equal(next.verified, false);
    const issue = r.scenes.find((s) => s.truthName === "課題・いちばん")!;
    assert.equal(issue.matched, true);
    assert.equal(r.climax?.matched, true);
    assert.equal(r.items[0].good?.matched, true);
    assert.equal(r.items[1].bad?.matched, true);
  });

  test("軸 5：性質の言葉を拾い、本番の検査が表示を控えた欄も数え、点が工程 1 に混ざっていないかを見る", () => {
    const r = axis5(step1, step2, null, null);
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].word, "傾向");
    assert.equal(r.withheld.length, 1);
    assert.equal(r.withheld[0].step, "step1");
    assert.equal(r.scoresInStep1, false);
    assert.equal(r.scoresPerItem, true);
  });

  test("軸 8：初回の面談で項目 5 が「判定しない」", () => {
    const r = axis8(step1, step2, truth);
    assert.equal(r.item5Withheld, true);
    assert.equal(r.withheldAsTruth[4].ai, true);
  });

  test("軸 9：○ の項目の点が × の項目より高いか。○× と判定しないは数えず、〔案〕の項目は分ける", () => {
    const r = axis9(step2.items, truth, a);
    assert.equal(r.pairs.length, 1); // 項目 1（○）× 項目 2（×）。項目 3 は〔案〕
    assert.equal(r.satisfied, 1);
    assert.equal(r.pairsIncludingDraft, 2);
    assert.deepEqual(r.absentItems, []);
  });

  test("軸 9：正解の範囲がすべて文字起こしに無い項目は分母から外す", () => {
    const t2: Truth = { ...truth, items: { ...truth.items, "2": { mark: "×", good: null, bad: { lines: [4], source: "作り手" } } } }; // 4 行目は文字起こしに無い
    const r = axis9(step2.items, t2, a);
    assert.deepEqual(r.absentItems, [2]);
    assert.equal(r.pairs.length, 0);
  });

  test("軸 2・6：複数の発話にまたがる引用は、終わりの発話まで数える", () => {
    assert.deepEqual(quoteIndices({ index: 2, endIndex: 4 }), [2, 3]);
    assert.deepEqual(quoteIndices({ index: 2, endIndex: 3 }), [2]);
    const spanning: Step1Result = {
      ...step1,
      scenes: [{ ...step1.scenes[0], quotes: [{ citedText: "x", text: "x", index: 1, endIndex: 3, verified: true }] }],
    };
    const r = axis2(spanning, truth, transcript, a);
    assert.deepEqual(r.aiScenes[0].utterances, [1, 2]);
    assert.ok(r.aiScenes[0].lines.includes(2) && r.aiScenes[0].lines.includes(3));
    const r6 = axis6(
      { verdict: "できた", quotes: [{ citedText: "x", text: "x", index: 1, endIndex: 3, verified: true }], discardedQuotes: [], why: "", items: [], total: { sum: 0, judgedCount: 0, max: 0, scaled: null }, otherPersonLine: null, quoteStats: { generated: 1, discarded: 0 }, firstCitationMs: null, rawText: "", meta: step1.meta, withheld: [], unverifiedQuotes: [] },
      { ...truth, followUp: { previousAction: { text: "x", source: "案" }, criterion: null, verdict: "できた", evidenceLines: [3], source: "決め" } },
      transcript,
      a,
    );
    assert.equal(r6?.evidenceOverlaps, true);
  });

  test("軸 11：話者の正しさと、確からしさごとの誤り", () => {
    const r = axis11(transcript, a, script);
    assert.equal(r.aligned, 5);
    assert.equal(r.correct, 4);
    assert.equal(r.wrong[0].index, 3);
    assert.equal(r.byConfidence.find((b) => b.confidence === "低")?.wrong, 1);
  });

  test("軸 12：直した言葉を対応する台本の位置そのものと比べ、拾えた直しと直しすぎを分ける。推測が本当に崩れていた所に付いたかを見る", () => {
    const r = axis12(transcript, a);
    const c1 = r.corrections.find((c) => c.before === "古文")!;
    assert.equal(c1.verdict, "拾えた");
    assert.equal(c1.scriptWindow, "顧問");
    const c2 = r.corrections.find((c) => c.before === "だっけ")!;
    assert.equal(c2.verdict, "元が正しかった");
    // 場所は合うが、台本の位置そのものとは違う言葉（「顧問」の位置に「顧問の」）
    const t3: Transcript = { ...transcript, step0b: { proposed: [], applied: [{ index: 1, kind: "x", before: "古文", after: "顧問の" }], discarded: [] } };
    assert.equal(axis12(t3, a).corrections[0].verdict, "言った言葉と違う");
    assert.equal(r.picked, 1);
    assert.equal(r.overfixedOriginalCorrect, 1);
    assert.equal(r.overfixedWrongWord, 0);
    assert.ok(r.mismatchSpots >= 1);
    assert.equal(r.guesses[0].reallyBroken, true);
    assert.equal(r.guesses[0].guessMatchesScript, true);
    assert.equal(r.guesses[0].changedCorrect, false);
  });

  test("整形の揺れ：話者の食い違いと直しの数", () => {
    const run2: Transcript = { ...transcript, utterances: transcript.utterances.map((u, i) => (i === 3 ? { ...u, speaker: "講師" } : u)) };
    const v = step0Variance([transcript, run2]);
    assert.equal(v.speakerDisagreements, 1);
    assert.deepEqual(v.correctionCounts, [2, 2]);
    assert.equal(v.correctionsCommonToAll, 2);
  });
});
