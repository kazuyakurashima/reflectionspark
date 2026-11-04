import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { guardStep1, guardStep2, guardStep3, guardStep4, guardStep0c, stripUnverifiedQuotes, WITHHELD_NOTICE } from "./guard.mts";
import type { Scene, Utterance } from "./types.mts";

const utterances: Utterance[] = ["じゃあ、始めようか。今日、部活は？", "今日は早めに終わりました。", "大丈夫、これからだよ。夏から頑張ろう。", "……はい。"].map((t, i) => ({
  index: i,
  speaker: i % 2 === 0 ? "講師" : "生徒",
  text: t,
  original: t,
  confidence: "高" as const,
  check: [],
  memoSpan: null,
}));

const scene = (over: Partial<Scene>): Scene => ({
  type: "よく表れた所",
  items: [],
  context: "",
  quotes: [],
  discardedQuotes: [],
  quotedTextInBody: "",
  observation: "",
  reaction: "",
  reading: "",
  asChoice: null,
  question: "",
  record: { whyChosen: "", runnerUp: [] },
  ...over,
});

describe("本番の出力の検査（決まり 1・3）", () => {
  test("「」の中が発話の原文に無ければ「」を外す。あれば残す", () => {
    const r = stripUnverifiedQuotes("講師が「大丈夫、これからだよ」と言い、生徒は「はい」と答えた。生徒は「もう無理です」と言った。", utterances, "observation");
    assert.equal(r.text, "講師が「大丈夫、これからだよ」と言い、生徒は「はい」と答えた。生徒はもう無理ですと言った。");
    assert.deepEqual(r.stripped, [{ field: "observation", text: "もう無理です" }]);
  });

  test("『』も同じに扱い、空の「」は外す", () => {
    const r = stripUnverifiedQuotes("『夏から頑張ろう』と『来年から』、「」。", utterances, "reading");
    assert.equal(r.text, "『夏から頑張ろう』と来年から、。");
  });

  test("工程 1：性質の言葉が入った欄は出さず、記録に残す。ほかの欄はそのまま", () => {
    const r = guardStep1(
      {
        scenes: [scene({ context: "進路の話。", reading: "講師は話しすぎる傾向があると読める。", question: "次に同じ場面が来たら、何を試しますか。" })],
        noScene: null,
        summary: "慎重な人の面談。",
        flow: ["主題", "転機"],
        extraQuestion: null,
        quoteStats: { generated: 0, discarded: 0, scenesWithoutQuote: 1 },
        rawText: "",
      },
      utterances,
    );
    assert.equal(r.scenes[0].reading, WITHHELD_NOTICE);
    assert.equal(r.scenes[0].context, "進路の話。");
    assert.equal(r.summary, WITHHELD_NOTICE);
    assert.equal(r.withheld.length, 2);
    assert.deepEqual(r.withheld[0], { field: "scenes[0].reading", words: ["傾向"], original: "講師は話しすぎる傾向があると読める。" });
  });

  test("原文と一致した「」の中の言葉は検査しない。一致しない「」は外してから検査する", () => {
    const r = guardStep1(
      {
        scenes: [scene({ observation: "教室長が「おとなしいタイプだから」と言った。", reaction: "生徒は「性格の問題」と返した。" })],
        noScene: null,
        summary: "",
        flow: [],
        extraQuestion: null,
        quoteStats: { generated: 0, discarded: 0, scenesWithoutQuote: 1 },
        rawText: "",
      },
      [...utterances, { index: 4, speaker: "講師", text: "おとなしいタイプだから、ね。", original: "おとなしいタイプだから、ね。", confidence: "高", check: [], memoSpan: null }],
    );
    assert.equal(r.scenes[0].observation, "教室長が「おとなしいタイプだから」と言った。");
    assert.equal(r.scenes[0].reaction, WITHHELD_NOTICE);
    assert.deepEqual(r.unverifiedQuotes, [{ field: "scenes[0].reaction", text: "性格の問題" }]);
  });

  test("工程 2・4：理由の一行と、なぜの一文を検査する。所属の手順の 1 行は変えない", () => {
    const items = [1, 2, 3, 4, 5].map((n) => ({ item: n as 1, score: 3, reason: n === 2 ? "講師が決めるべきだった。" : "受け止めた。", utterances: [] }));
    const r2 = guardStep2({ items, total: { sum: 15, judgedCount: 5, max: 25, scaled: 6 }, insightOwner: "講師", ethics: { level: "所属の手順", text: "この話は、所属の手順に沿って扱ってください", viewpoint: null, utterances: [] } }, utterances);
    assert.equal(r2.items[1].reason, WITHHELD_NOTICE);
    assert.equal(r2.items[0].reason, "受け止めた。");
    assert.equal(r2.ethics.text, "この話は、所属の手順に沿って扱ってください");
    const r4 = guardStep4(
      { verdict: "できた", quotes: [], discardedQuotes: [], why: "前回の行動が「夏から頑張ろう」の後に現れた。", items, total: { sum: 15, judgedCount: 5, max: 25, scaled: 6 }, otherPersonLine: "相手は几帳面な人で、やってきた。", quoteStats: { generated: 0, discarded: 0 }, rawText: "" },
      utterances,
    );
    assert.equal(r4.why, "前回の行動が「夏から頑張ろう」の後に現れた。");
    assert.equal(r4.otherPersonLine, WITHHELD_NOTICE);
  });

  test("工程 3・0c：候補の「」は外さない（相手が誰でも起こりうる形）。性質の言葉だけ検査する", () => {
    const r3 = guardStep3(
      {
        candidates: [{ condition: "相手が『〜したい』と言うのに行動が出ていないとき", action: "差を返して聞く", sentence: "もし相手が『〜したい』と言うのに行動が出ていないとき、差を返して聞く。", lines: ["どう思う？"], criterion: "慎重な人には合わない。" }],
        dropped: [],
      },
      utterances,
    );
    assert.equal(r3.candidates[0].condition, "相手が『〜したい』と言うのに行動が出ていないとき");
    assert.equal(r3.candidates[0].criterion, WITHHELD_NOTICE);
    assert.equal(r3.unverifiedQuotes.length, 0);
    const r0c = guardStep0c({ summary: "進路の面談。生徒は内向的なタイプ。", guesses: [{ index: 1, kind: "崩れ", fragment: "古文", guess: "顧問", clue: "部活の話" }] }, utterances);
    assert.equal(r0c.summary, WITHHELD_NOTICE);
    assert.equal(r0c.guesses[0].clue, "部活の話");
  });
});
