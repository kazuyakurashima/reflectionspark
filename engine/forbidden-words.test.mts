import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { scanObject, scanText } from "./forbidden-words.mts";
import { WITHHELD_NOTICE } from "./guard.mts";

describe("決まり 3：人物の性質の言葉の検出（軸 5）", () => {
  test("性質の言葉、優劣、「〜すべき」を拾う", () => {
    const hits = scanText("講師は慎重な人で、説明を足す癖がある。ここは聞くべきだった。相手はおとなしいタイプ。", "reading");
    const words = hits.map((h) => h.word);
    assert.ok(words.includes("〜な人"));
    assert.ok(words.includes("癖"));
    assert.ok(words.includes("〜べき"));
    assert.ok(words.includes("タイプ"));
  });

  test("場面と行動の書き方は拾わない", () => {
    const hits = scanText("この 2 回では、生徒が「やばいですよね」と言った後に、講師が講習の説明を足した。直後の生徒の返事は「はい」だけだった。", "reading");
    assert.deepEqual(hits, []);
  });

  test("決まり 3：教科や問題の「性質」は人の話ではないので拾わない。人の「性質」は拾う", () => {
    assert.deepEqual(scanText("講師は時期の見通しと数学の性質を話した。関数の性質にも触れた。", "observation"), []);
    assert.deepEqual(scanText("生徒の性質に合わせた。", "observation").map((h) => h.word), ["性質"]);
    assert.deepEqual(scanText("講師の性質が表れた。", "reading").map((h) => h.word), ["性質"]);
    assert.deepEqual(scanText("そういう性質だと読める。", "reading").map((h) => h.word), ["性質"]);
  });

  test("決まり 3：控えたときの案内の文は、検査に当たらない", () => {
    assert.deepEqual(scanText(WITHHELD_NOTICE, "observation"), []);
  });

  test("「 」の中（言った言葉）は数えない", () => {
    const hits = scanText("教室長が「おとなしいタイプだから」と言った直後、若手講師は黙った。", "observation");
    assert.deepEqual(hits, []);
  });

  test("出力のオブジェクトを辿り、cited_text と original は飛ばす", () => {
    const hits = scanObject({
      scenes: [{ quotes: [{ cited_text: "おとなしいタイプだから" }], reading: "説明を足したと読める。" }],
      utterances: [{ original: "性格が悪いタイプ", speaker: "生徒" }],
      summary: "講師は話しすぎる傾向がある。",
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].word, "傾向");
    assert.equal(hits[0].field, "summary");
  });
});
