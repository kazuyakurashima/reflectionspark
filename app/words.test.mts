// 画面に出す言葉（app/lib/words.mts）。「発話 n」を「発言 n」と読み替えるのは番号の付いた所だけで、番号は変えない。
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dropRefs, refLabel, refListLabel, refRangeLabel, sayRefs, sceneTypeLabel, splitRefs } from "./lib/words.mts";

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

  test("前回の面談の番号は、今回の発言の印にしない（面談ごとに番号が違うため）", () => {
    assert.deepEqual(splitRefs("前回の面談の発話 2 と同じ形で", 10), [{ text: "前回の面談の" }, { text: "発言 2" }, { text: " と同じ形で" }]);
    assert.deepEqual(splitRefs("前回の発話 2〜4 では", 10), [{ text: "前回の" }, { text: "発言 2" }, { text: "〜" }, { text: "4" }, { text: " では" }]);
    assert.deepEqual(splitRefs("前の面談の 発話 2", 10), [{ text: "前の面談の " }, { text: "発言 2" }]);
    // 今回の番号は、同じ文の中でも印にする
    assert.deepEqual(splitRefs("前回の面談の発話 2 に近く、発話 3 で返した", 10), [{ text: "前回の面談の" }, { text: "発言 2" }, { text: " に近く、" }, { text: "発言 3", index: 3 }, { text: " で返した" }]);
    // 「前の発話」は同じ面談の一つ前のことなので、前回の印にしない
    assert.deepEqual(splitRefs("前の発話 2 を受けて", 10), [{ text: "前の" }, { text: "発言 2", index: 2 }, { text: " を受けて" }]);
  });

  test("AI の文に出たプロンプトの語を、画面の場面の名前に読み替える", () => {
    assert.deepEqual(splitRefs("発話 3 がよく表れた所で、次の一手を決める所が次に試せる所として挙げられます。", 10), [{ text: "発言 3", index: 3 }, { text: " がうまくいった場面で、次の一手を決める所が課題が見えた場面として挙げられます。" }]);
    assert.equal(sayRefs("次に試せる所は発話 3"), "課題が見えた場面は発言 3");
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
    assert.equal(sceneTypeLabel("次に試せる所"), "課題が見えた場面");
  });
});

describe("画面の言葉：前の面談の AI の文から番号を外す（画面 3）", () => {
  test("発話を指す所を助詞まで外し、文はそのまま読める", () => {
    assert.equal(dropRefs("講師は発話 16 で前回の取り決めを持ち出し、発話 18 で様子を尋ねました。"), "講師は前回の取り決めを持ち出し、様子を尋ねました。");
    assert.equal(dropRefs("と答えました。続く発話 27 では、すぐやらないとスマホを見てしまうことも話しています。"), "と答えました。すぐやらないとスマホを見てしまうことも話しています。");
    assert.equal(dropRefs("その条件が発話 104 で帰宅後の時刻を決める話にもつながったと読めます。"), "その条件が帰宅後の時刻を決める話にもつながったと読めます。");
    assert.equal(dropRefs("説明を続けた（発話 94〜104）。"), "説明を続けた。");
    assert.equal(dropRefs("発話 40、発話 42・44 で確かめた。"), "確かめた。");
  });

  test("番号の無い「発話」と、「」の中は変えない", () => {
    assert.equal(dropRefs("生徒の発話が長くなった。"), "生徒の発話が長くなった。");
    assert.equal(dropRefs("「発話 3 で」と言った。3 日やった。"), "「発話 3 で」と言った。3 日やった。");
  });
});
