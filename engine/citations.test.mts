import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { blockText, blockTexts, quoteMatchesTranscript, verifyCitation } from "./citations.mts";
import { parseStep1 } from "./step1.mts";
import { makeSentence, parseStep3 } from "./step3.mts";
import { parseStep4 } from "./step4.mts";
import { parseStep2 } from "./step2.mts";
import type { Utterance } from "./types.mts";

const utterances: Utterance[] = [
  "じゃあ、始めようか。今日、部活は？",
  "今日は早めに終わりました。顧問の先生が出張で。",
  "そっか。吹奏楽、来月が最後のコンクールだっけ。",
  "はい。それで引退です。",
].map((t, i) => ({ index: i, speaker: i % 2 === 0 ? "講師" : "生徒", text: t, original: t, confidence: "高" as const, check: [], memoSpan: null }));

const cite = (start: number, end: number, cited: string) => ({
  type: "content_block_location" as const,
  cited_text: cited,
  document_index: 0,
  document_title: null,
  file_id: null,
  start_block_index: start,
  end_block_index: end,
});

describe("決まり 1：引用の照合", () => {
  test("document のブロックは「話者：本文」", () => {
    assert.equal(blockText(utterances[0]), "講師：じゃあ、始めようか。今日、部活は？");
    assert.equal(blockTexts(utterances).length, 4);
  });

  test("cited_text がブロックの全文と完全一致したときだけ verified になり、画面に出す本文は発話の本文と一致する", () => {
    const q = verifyCitation(cite(1, 2, "生徒：今日は早めに終わりました。顧問の先生が出張で。"), utterances);
    assert.equal(q.verified, true);
    assert.equal(q.text, utterances[1].text);
    assert.ok(quoteMatchesTranscript(q, utterances));
  });

  test("一字でも違えば捨てる（言い換え、省略、話者の違い）", () => {
    assert.equal(verifyCitation(cite(1, 2, "生徒：今日は早めに終わりました。"), utterances).verified, false);
    assert.equal(verifyCitation(cite(1, 2, "生徒：今日は早めに終わりました。顧問の先生が出張で"), utterances).verified, false);
    assert.equal(verifyCitation(cite(1, 2, "講師：今日は早めに終わりました。顧問の先生が出張で。"), utterances).verified, false);
    assert.equal(verifyCitation(cite(9, 10, "x"), utterances).verified, false);
    assert.equal(verifyCitation(cite(1, 1, "x"), utterances).verified, false);
  });

  test("複数ブロックの引用は、つないだ全文で照合し、本文は改行でつなぐ", () => {
    const q = verifyCitation(cite(2, 4, "講師：そっか。吹奏楽、来月が最後のコンクールだっけ。生徒：はい。それで引退です。"), utterances);
    assert.equal(q.verified, true);
    assert.equal(q.text, "そっか。吹奏楽、来月が最後のコンクールだっけ。\nはい。それで引退です。");
  });

  test("本文を出せない発話（当て直せなかった）は引用できない", () => {
    const u2 = utterances.map((u) => ({ ...u }));
    u2[1].text = null;
    assert.equal(verifyCitation(cite(1, 2, blockText(u2[1])), u2).verified, false);
  });
});

describe("工程 1 の本文の読み取りと、引用の場面への当て方", () => {
  const text = `<scene type="よく表れた所">
<items>1</items>
<context>部活の話を聞いた所。</context>
<quote>そっか。吹奏楽、来月が最後のコンクールだっけ。</quote>
<observation>講師が部活の予定を聞いた。</observation>
<reaction>生徒が「はい」と答えて続けた。</reaction>
<reading>相手の話題で始めたと読める。</reading>
<question>この場面で、何を聞きたいと思っていましたか。</question>
<why_chosen>最初に相手の話題を聞いている</why_chosen>
<runner_up>1, 3</runner_up>
</scene>
<scene type="次に試せる所">
<items></items>
<context>部活の終わり。</context>
<quote>今日は早めに終わりました。</quote>
<observation>x</observation>
<reaction>無い</reaction>
<reading>y と読める。</reading>
<as_choice>時間の都合があった可能性。</as_choice>
<question>次に同じ場面が来たら、何を試しますか。</question>
<why_chosen>z</why_chosen>
<runner_up>2</runner_up>
</scene>
<summary>よく表れた所は部活の話。次に試せる所は部活の終わり。</summary>
<flow>
部活の話
進路の話
終わり
</flow>
<extra_question></extra_question>`;
  const qStart = text.indexOf("そっか。吹奏楽");
  const q2Start = text.indexOf("今日は早めに終わりました。</quote>");
  const segments = [
    { text: text.slice(0, qStart), start: 0, end: qStart, citations: [] },
    { text: "そっか。吹奏楽、来月が最後のコンクールだっけ。", start: qStart, end: qStart + 23, citations: [cite(2, 3, "講師：そっか。吹奏楽、来月が最後のコンクールだっけ。")] },
    { text: text.slice(qStart + 23, q2Start), start: qStart + 23, end: q2Start, citations: [] },
    // 言い換えた引用（捨てる）
    { text: "今日は早めに終わりました。", start: q2Start, end: q2Start + 13, citations: [cite(1, 2, "生徒：今日は早めに終わりました。")] },
    { text: text.slice(q2Start + 13), start: q2Start + 13, end: text.length, citations: [] },
  ];

  test("場面ごとに欄を読み、照合済みの引用だけを場面に付ける。生成・捨てた・出せなかった数を残す", () => {
    const r = parseStep1(text, segments, utterances);
    assert.equal(r.scenes.length, 2);
    assert.equal(r.scenes[0].type, "よく表れた所");
    assert.deepEqual(r.scenes[0].items, [1]);
    assert.equal(r.scenes[0].quotes.length, 1);
    assert.equal(r.scenes[0].quotes[0].text, "そっか。吹奏楽、来月が最後のコンクールだっけ。");
    assert.equal(r.scenes[0].quotes[0].index, 2);
    assert.deepEqual(r.scenes[0].record.runnerUp, [1, 3]);
    assert.equal(r.scenes[1].quotes.length, 0);
    assert.equal(r.scenes[1].discardedQuotes.length, 1);
    assert.equal(r.scenes[1].asChoice, "時間の都合があった可能性。");
    assert.equal(r.scenes[1].quotedTextInBody, "今日は早めに終わりました。");
    assert.deepEqual(r.quoteStats, { generated: 2, discarded: 1, scenesWithoutQuote: 1 });
    assert.deepEqual(r.flow, ["部活の話", "進路の話", "終わり"]);
    assert.equal(r.extraQuestion, null);
    assert.equal(r.noScene, null);
  });

  test("根拠のある場面が無いときは no_scene を読む", () => {
    const r = parseStep1("<no_scene>本人の関わりが読める発話が無い。</no_scene><summary>s</summary><flow>a</flow>", [], utterances);
    assert.equal(r.scenes.length, 0);
    assert.equal(r.noScene, "本人の関わりが読める発話が無い。");
  });
});

describe("工程 2・3・4 の読み取り", () => {
  test("工程 2：判定しない項目は null。合計はアプリが計算し、保留は分母から外す", () => {
    const r = parseStep2(
      {
        items: [
          { item: 1, judged: true, score: 4, reason: "a", utterances: [2, 99] },
          { item: 2, judged: true, score: 3, reason: "b", utterances: [] },
          { item: 3, judged: true, score: 2, reason: "c", utterances: [] },
          { item: 4, judged: true, score: 3, reason: "d", utterances: [] },
          { item: 5, judged: false, score: 0, reason: "初回", utterances: [] },
        ],
        insight_owner: "両方",
        ethics: { level: "問題なし", text: "問題なし", viewpoint: "", utterances: [] },
      },
      4,
    );
    assert.equal(r.items[4].score, null);
    assert.deepEqual(r.items[0].utterances, [2]);
    assert.deepEqual(r.total, { sum: 12, judgedCount: 4, max: 20, scaled: 6 });
    assert.equal(r.ethics.viewpoint, null);
  });

  test("工程 2：相手の安全にかかわる話は、点にせず決まった 1 行にする", () => {
    const r = parseStep2({ items: [], insight_owner: "講師", ethics: { level: "所属の手順", text: "x", viewpoint: "", utterances: [] } }, 4);
    assert.equal(r.ethics.text, "この話は、所属の手順に沿って扱ってください");
    assert.equal(r.items.length, 5);
  });

  test("工程 3：「もし〜なら、〜する」の一文にし、言葉に表れない行動は落とす", () => {
    assert.equal(makeSentence("もし生徒が黙ったら", "解説を足さずに「何でもいいよ」と言う。"), "もし生徒が黙ったら、解説を足さずに「何でもいいよ」と言う。");
    assert.equal(makeSentence("相手が差を口にした", "その差を返して、どう思うかを聞く"), "もし相手が差を口にしたなら、その差を返して、どう思うかを聞く。");
    const r = parseStep3({
      candidates: [
        { condition: "生徒が黙ったら", action: "待つ", lines: ["…"], criterion: "x" },
        { condition: "生徒が黙ったら", action: "解説を足さずに「何でもいいよ」と言う", lines: ["何でもいいよ", "思いついたことで"], criterion: "次の面談で、問いの後に講師の次の発話が短い" },
        { condition: "生徒が黙ったら", action: "「それで？」と聞く", lines: [], criterion: "x" },
      ],
    });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.dropped.length, 2);
    assert.match(r.dropped[0].reason, /言葉に表れない/);
  });

  test("工程 4：判定・引用・なぜ・項目を読む", () => {
    const text = `<verdict>できた</verdict>
<quote>そっか。吹奏楽、来月が最後のコンクールだっけ。</quote>
<why>前回の行動が言葉を変えて現れた。</why>
<items>
<item n="1" score="4" utterances="0, 2">受け止めた。</item>
<item n="2" score="3" utterances="2">足した。</item>
<item n="3" score="2" utterances="">抽象的。</item>
<item n="4" score="判定しない" utterances="">目標の話を求めない。</item>
<item n="5" score="5" utterances="2">前回に触れた。</item>
</items>
<other_line></other_line>`;
    const qs = text.indexOf("そっか。");
    const segments = [
      { text: text.slice(0, qs), start: 0, end: qs, citations: [] },
      { text: "そっか。吹奏楽、来月が最後のコンクールだっけ。", start: qs, end: qs + 23, citations: [cite(2, 3, "講師：そっか。吹奏楽、来月が最後のコンクールだっけ。")] },
      { text: text.slice(qs + 23), start: qs + 23, end: text.length, citations: [] },
    ];
    const r = parseStep4(text, segments, utterances);
    assert.equal(r.verdict, "できた");
    assert.equal(r.quotes.length, 1);
    assert.equal(r.quotes[0].index, 2);
    assert.equal(r.why, "前回の行動が言葉を変えて現れた。");
    assert.equal(r.items[3].score, null);
    assert.deepEqual(r.items[0].utterances, [0, 2]);
    assert.equal(r.total.judgedCount, 4);
    assert.equal(r.otherPersonLine, null);
  });
});

describe("構造化出力のスキーマ", () => {
  test("受け付けない制約（minimum など）を外す", async () => {
    const { sanitizeSchema } = await import("./claude.mts");
    const { STEP2_SCHEMA } = await import("./prompts.mts");
    const s = JSON.stringify(sanitizeSchema(STEP2_SCHEMA));
    assert.doesNotMatch(s, /minimum|maximum/);
    assert.match(s, /additionalProperties/);
  });
});
