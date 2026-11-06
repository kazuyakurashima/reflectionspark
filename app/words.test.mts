// 画面に出す言葉（app/lib/words.mts）。「発話 n」を「発言 n」と読み替えるのは番号の付いた所だけで、番号は変えない。
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { refLabel, refListLabel, refRangeLabel, sayRefs, sceneTypeLabel, splitRefs } from "./lib/words.mts";

describe("画面の言葉：発言の番号", () => {
  test("番号は変えず、呼び方だけ「発言」にする", () => {
    assert.equal(refLabel(40), "発言 40");
    assert.equal(refRangeLabel(3, 8), "発言 3〜8");
    assert.equal(refRangeLabel(3, 3), "発言 3");
    assert.equal(refListLabel([3, 5, 8]), "発言 3、5、8");
  });

  test("AI の文の中の「発話 n」を、発言を開ける印に分ける", () => {
    assert.deepEqual(splitRefs("発話 42 では生徒の言葉を返し、発話 44 で確かめた。", 128), [
      { text: "発言 42", index: 42 },
      { text: " では生徒の言葉を返し、" },
      { text: "発言 44", index: 44 },
      { text: " で確かめた。" },
    ]);
  });

  test("続けて書いた番号と範囲も、一つずつ印にする", () => {
    assert.deepEqual(splitRefs("説明を続けた（発話 94〜104）。", 128), [{ text: "説明を続けた（" }, { text: "発言 94", index: 94 }, { text: "〜" }, { text: "104", index: 104 }, { text: "）。" }]);
    assert.deepEqual(
      splitRefs("発話 40、発話 42・44", 128).filter((p) => p.index !== undefined),
      [
        { text: "発言 40", index: 40 },
        { text: "発言 42", index: 42 },
        { text: "44", index: 44 },
      ],
    );
  });

  test("範囲に無い番号は印にしない。助数詞の付いた数は番号として読まない", () => {
    assert.deepEqual(splitRefs("発話 500 のあたり", 128), [{ text: "発言 500" }, { text: " のあたり" }]);
    assert.deepEqual(splitRefs("発話 3 と 5 つの候補", 128), [{ text: "発言 3", index: 3 }, { text: " と 5 つの候補" }]);
  });

  test("番号の無い「発話」と、ほかの文字には手を入れない", () => {
    assert.equal(sayRefs("生徒の発話が長くなった。「発話」という言葉。"), "生徒の発話が長くなった。「発話」という言葉。");
    assert.equal(sayRefs("家での過ごし方を聞く（発話 78〜114）"), "家での過ごし方を聞く（発言 78〜114）");
    assert.deepEqual(splitRefs("", 10), []);
  });
});

describe("画面の言葉：場面の種別（決まり 3）", () => {
  test("場面についての言葉で出す", () => {
    assert.equal(sceneTypeLabel("よく表れた所"), "うまくいった場面");
    assert.equal(sceneTypeLabel("次に試せる所"), "次に試せる場面");
  });
});
