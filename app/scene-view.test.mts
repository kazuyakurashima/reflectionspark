// 画面 2 の場面と地図の計算（app/lib/scene-view.mts）。
// 画面で目立たせる発話と「引用」の印は、照合済みの引用だけから決める（決まり 1）。地図の区切りは、読めないときは出さない。
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { chapterIndexOf, chaptersOf, refGroups, sceneSpan, spanWindow, talkByChapter, wideWindow } from "./lib/scene-view.mts";

const q = (index: number, verified = true, endIndex = index + 1) => ({ index, endIndex, verified });

describe("画面 2：場面に並べる発話の範囲（決まり 1）", () => {
  test("引用が 1 つなら、その発話だけが範囲で、いちばん目立たせる発話になる", () => {
    assert.deepEqual(sceneSpan([q(40)], 132), { from: 40, to: 40, focal: 40, quoted: [40] });
  });

  test("最初の引用とつながった引用をひと続きにし、離れた引用は範囲に入れない", () => {
    const span = sceneSpan([q(40), q(39), q(42), q(44), q(46), q(41), q(43)], 132);
    assert.deepEqual(span, { from: 39, to: 44, focal: 40, quoted: [39, 40, 41, 42, 43, 44, 46] });
  });

  test("原文と一致しなかった引用は使わない。一致した引用が無ければ null", () => {
    assert.deepEqual(sceneSpan([q(10, false), q(12)], 50), { from: 12, to: 12, focal: 12, quoted: [12] });
    assert.equal(sceneSpan([q(10, false)], 50), null);
    assert.equal(sceneSpan([], 50), null);
  });

  test("発話の並びの外を指す引用は使わない", () => {
    assert.equal(sceneSpan([q(50)], 50), null);
  });

  test("いくつかの発話にまたがる引用は、その全部を範囲に入れる", () => {
    assert.deepEqual(sceneSpan([q(5, true, 8)], 20), { from: 5, to: 7, focal: 5, quoted: [5, 6, 7] });
  });

  test("前後の発話は、並びの端で止める", () => {
    assert.deepEqual(spanWindow({ from: 40, to: 40 }, 132, 1), { from: 39, to: 41 });
    assert.deepEqual(spanWindow({ from: 0, to: 1 }, 3, 3), { from: 0, to: 2 });
  });

  test("広げた範囲は、前後 3 発話と、AI が文で触れた近くの発話までを入れる。遠い発話と範囲の外の番号は入れない", () => {
    assert.deepEqual(wideWindow({ from: 40, to: 40 }, [], 128), { from: 37, to: 43 });
    assert.deepEqual(wideWindow({ from: 40, to: 40 }, [42, 44, 46, 41, 120, -1, 500], 128), { from: 37, to: 46 });
    assert.deepEqual(wideWindow({ from: 92, to: 92 }, [84, 75], 128), { from: 84, to: 95 });
    assert.deepEqual(wideWindow({ from: 1, to: 1 }, [0], 3), { from: 0, to: 2 });
  });
});

describe("画面 2：地図の区切り", () => {
  const flow = ["部活とコンクールの話から始まる（発話 0〜11）", "進路の話（発話 12〜35）", "締めくくる（発話 36〜49）"];

  test("文の末尾の発話番号の範囲を読み、文からは外す", () => {
    assert.deepEqual(chaptersOf(flow, 50), [
      { from: 0, to: 11, text: "部活とコンクールの話から始まる" },
      { from: 12, to: 35, text: "進路の話" },
      { from: 36, to: 49, text: "締めくくる" },
    ]);
  });

  test("範囲が行の頭にあっても、括弧の後に続きがあっても読む（AI は回ごとに書き方を変える）", () => {
    assert.deepEqual(chaptersOf(["発話 0〜11：部活とコンクールの話", "発話 12〜35：第一志望が南高であることの確認"], 50), [
      { from: 0, to: 11, text: "部活とコンクールの話" },
      { from: 12, to: 35, text: "第一志望が南高であることの確認" },
    ]);
    assert.deepEqual(chaptersOf(["近況の確認（発話 0〜15）：続けている行動が語られる", "火曜のクラスの様子（発話 16〜19）。"], 50), [
      { from: 0, to: 15, text: "近況の確認：続けている行動が語られる" },
      { from: 16, to: 19, text: "火曜のクラスの様子" },
    ]);
  });

  test("中身の途中の括弧（範囲でないもの）は中身として残す", () => {
    assert.deepEqual(chaptersOf(["志望を決めたきっかけ（定期演奏会）と英語の話（発話 12〜35）"], 50), [{ from: 12, to: 35, text: "志望を決めたきっかけ（定期演奏会）と英語の話" }]);
  });

  test("番号が読めない文が一つでもあれば、区切りを出さない", () => {
    assert.deepEqual(chaptersOf(["部活の話", "進路の話（発話 12〜35）"], 50), []);
    assert.deepEqual(chaptersOf(["部活の話（1-1〜1-12）"], 50), []);
  });

  test("範囲の外や、順番が前後する番号があれば、区切りを出さない", () => {
    assert.deepEqual(chaptersOf(["部活の話（発話 0〜60）"], 50), []);
    assert.deepEqual(chaptersOf(["部活の話（発話 0〜11）", "進路の話（発話 10〜35）"], 50), []);
  });

  test("発話が入っている区切りを返す", () => {
    const c = chaptersOf(flow, 50);
    assert.equal(chapterIndexOf(c, 40), 2);
    assert.equal(chapterIndexOf(c, 11), 0);
    assert.equal(chapterIndexOf([], 3), -1);
  });
});

describe("画面 2：話題ごとの話した量（点には入れない）", () => {
  const u = (index: number, speaker: string, text: string | null, original = text ?? "") => ({ index, speaker, text, original });
  const utterances = [u(0, "講師", "こんにちは"), u(1, "生徒", "はい"), u(2, "講師", "今日は進路の話"), u(3, "生徒", null, "えっと迷ってて")];
  const chapters = [
    { from: 0, to: 1, text: "あいさつ" },
    { from: 2, to: 3, text: "進路の話" },
  ];

  test("区切りごとに、本人と相手の文字数と本人の割合を数える", () => {
    const r = talkByChapter(chapters, utterances, "講師");
    assert.deepEqual(
      r.map((c) => [c.text, c.selfChars, c.otherChars]),
      [
        ["あいさつ", 5, 2],
        ["進路の話", 7, 7],
      ],
    );
    assert.equal(r[1].selfRatio, 0.5);
  });

  test("直しを当てられなかった発話は、元の文で数える", () => {
    assert.equal(talkByChapter(chapters, utterances, "講師")[1].otherChars, [..."えっと迷ってて"].length);
  });

  test("区切りが無ければ空。誰も話していない区切りは割合 0", () => {
    assert.deepEqual(talkByChapter([], utterances, "講師"), []);
    assert.equal(talkByChapter([{ from: 9, to: 9, text: "x" }], utterances, "講師")[0].selfRatio, 0);
  });
});

describe("画面 2：会話を確認するの、か所のまとまり", () => {
  test("近い番号（あいだが 2 発話まで）は 1 か所にまとめ、離れた番号は別のか所にする。範囲の外と重なりは捨てる", () => {
    assert.deepEqual(refGroups([95, 93, 94, 96, 73, 75], 130), [
      { from: 73, to: 75 },
      { from: 93, to: 96 },
    ]);
    assert.deepEqual(refGroups([40, 42, 44, 41, 43, 45], 130), [{ from: 40, to: 45 }]);
    assert.deepEqual(refGroups([10, 20, 30, -1, 999, 10], 100), [
      { from: 10, to: 10 },
      { from: 20, to: 20 },
      { from: 30, to: 30 },
    ]);
    assert.deepEqual(refGroups([], 100), []);
  });
});
