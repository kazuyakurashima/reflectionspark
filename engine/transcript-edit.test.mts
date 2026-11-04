import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CHECK_UNANCHORED } from "./step0.mts";
import { CHECK_ORIGINAL_SAME_AS_TEXT, CHECK_SPLIT_BY_USER, splitUtterance } from "./transcript-edit.mts";
import type { Transcript } from "./types.mts";

function make(): Transcript {
  const texts = ["じゃあ始めようか。", "はいあ、ごめん会場はどこ", "市民会館です。"];
  let pos = 0;
  return {
    kind: "生徒",
    raw: texts.join(""),
    multipleOthers: false,
    utterances: texts.map((t, i) => {
      const s = pos;
      pos += [...t].length;
      return { index: i, speaker: i === 1 ? "生徒" : i === 0 ? "講師" : "生徒", text: t, original: t, confidence: i === 1 ? ("低" as const) : ("高" as const), check: i === 1 ? [CHECK_UNANCHORED] : [], memoSpan: [s, pos] as [number, number] };
    }),
    step0b: { proposed: [], applied: [{ index: 2, kind: "x", before: "市民", after: "市民" }], discarded: [] },
    step0c: { summary: "", guesses: [{ index: 1, kind: "崩れ", fragment: "会場はどこ", guess: "会場はどこ？", clue: "" }] },
  };
}

describe("画面 1 で発話を分ける", () => {
  test("区切りが分からない所を、本人がカーソルの位置で 2 つに分け、番号と直し・推測の番号を付け替える", () => {
    const t = splitUtterance(make(), 1, 2); // 「はい」｜「あ、ごめん会場はどこ」
    assert.deepEqual(
      t.utterances.map((u) => [u.index, u.speaker, u.original]),
      [
        [0, "講師", "じゃあ始めようか。"],
        [1, "生徒", "はい"],
        [2, "講師", "あ、ごめん会場はどこ"],
        [3, "生徒", "市民会館です。"],
      ],
    );
    assert.deepEqual(t.utterances[1].memoSpan, [9, 11]);
    assert.deepEqual(t.utterances[2].memoSpan, [11, 21]);
    assert.ok(t.utterances[1].check.includes(CHECK_SPLIT_BY_USER));
    assert.ok(!t.utterances[1].check.includes(CHECK_UNANCHORED));
    assert.equal(t.step0b.applied[0].index, 3);
    assert.equal(t.step0c?.guesses[0].index, 2);
  });

  test("端で分けようとしたときは何もしない", () => {
    const t = make();
    assert.equal(splitUtterance(t, 1, 0), t);
    assert.equal(splitUtterance(t, 1, 99), t);
  });

  test("直した所がある発話は、後半の元の文を本文にして印を付ける", () => {
    const t = make();
    t.utterances[1].text = "はいあ、ごめん会場はどこ？";
    const r = splitUtterance(t, 1, 2);
    assert.equal(r.utterances[1].original, "はいあ、ごめん会場はどこ");
    assert.equal(r.utterances[2].original, "あ、ごめん会場はどこ？");
    assert.ok(r.utterances[2].check.includes(CHECK_ORIGINAL_SAME_AS_TEXT));
  });
});
