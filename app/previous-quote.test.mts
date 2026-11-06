// 画面 5 に出す「前回の発言」（app/lib/previous-quote.mts）。
// 保存してある引用を、行動を決めた面談の発話ともう一度完全一致で照らし、一致しないものは出さない（決まり 1）。
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Utterance } from "../engine/types.mts";
import { previousQuoteOf } from "./lib/previous-quote.mts";

function u(index: number, speaker: string, text: string | null): Utterance {
  return { index, speaker, text, original: text ?? "（元の文）", confidence: "高", check: [], memoSpan: null };
}

const utterances: Utterance[] = [
  u(0, "講師", "家ではどれくらいやってる？"),
  u(1, "生徒", "ほぼゼロです。"),
  u(2, "講師", "大丈夫。これからだよ。"),
  u(3, "生徒", "はい。"),
  u(4, "講師", "はい。"),
  u(5, "生徒", "はい。"),
  u(6, "講師", null),
];

describe("画面 5：前回の発言（決まり 1）", () => {
  test("発話の本文と完全一致した引用は、話者と発話番号を付けて出す", () => {
    assert.deepEqual(previousQuoteOf("大丈夫。これからだよ。", utterances), { text: "大丈夫。これからだよ。", index: 2, speaker: "講師" });
  });

  test("一字でも違う引用は出さない", () => {
    assert.equal(previousQuoteOf("大丈夫、これからだよ。", utterances), null);
    assert.equal(previousQuoteOf("大丈夫。これからだよ", utterances), null);
    assert.equal(previousQuoteOf("これからだよ。", utterances), null);
  });

  test("引用が無い・発話が無いときは出さない", () => {
    assert.equal(previousQuoteOf(null, utterances), null);
    assert.equal(previousQuoteOf(undefined, utterances), null);
    assert.equal(previousQuoteOf("", utterances), null);
    assert.equal(previousQuoteOf("大丈夫。これからだよ。", null), null);
    assert.equal(previousQuoteOf("大丈夫。これからだよ。", []), null);
  });

  test("続いた発話にまたがる引用は、改行でつないだ本文と一致すれば出す。話者が分かれるので話者は付けない", () => {
    assert.deepEqual(previousQuoteOf("ほぼゼロです。\n大丈夫。これからだよ。", utterances), { text: "ほぼゼロです。\n大丈夫。これからだよ。", index: 1, speaker: null });
  });

  test("離れた発話をつないだ文は出さない", () => {
    assert.equal(previousQuoteOf("家ではどれくらいやってる？\n大丈夫。これからだよ。", utterances), null);
  });

  test("同じ本文が 2 か所以上にあるときは、発話番号を付けない。話者が分かれていれば話者も付けない", () => {
    assert.deepEqual(previousQuoteOf("はい。", utterances), { text: "はい。", index: null, speaker: null });
    const sameSpeaker = [u(0, "生徒", "はい。"), u(1, "講師", "そうか。"), u(2, "生徒", "はい。")];
    assert.deepEqual(previousQuoteOf("はい。", sameSpeaker), { text: "はい。", index: null, speaker: "生徒" });
  });

  test("本文を出せない発話（text が null）とは照らさない", () => {
    assert.equal(previousQuoteOf("（元の文）", utterances), null);
  });
});
