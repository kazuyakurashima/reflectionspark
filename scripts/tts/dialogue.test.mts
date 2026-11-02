import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { countChars, MAX_VOICES_PER_REQUEST, parseDialogue, splitIntoChunks } from "./dialogue.mts";
import type { Utterance } from "./dialogue.mts";

describe("台本の読み取り", () => {
  test("「話者名：本文」を発話にし、行番号を残す", () => {
    const got = parseDialogue("講師：じゃあ、始めようか。\n生徒：はい。\n");
    assert.deepEqual(got, [
      { line: 1, speaker: "講師", text: "じゃあ、始めようか。" },
      { line: 2, speaker: "生徒", text: "はい。" },
    ]);
  });

  test("[hesitates] などの英語の括弧は、演技の指示としてそのまま残す", () => {
    const [u] = parseDialogue("生徒：[hesitates] えっと……[sighs] 分かんないです。");
    assert.equal(u.text, "[hesitates] えっと……[sighs] 分かんないです。");
  });

  test("空行と # で始まる行は飛ばし、行番号は台本のままにする", () => {
    const got = parseDialogue("# 生徒面談のダミー\n\n講師：始めよう。\n   \n生徒：はい。");
    assert.deepEqual(
      got.map((u) => u.line),
      [3, 5],
    );
  });

  test("半角のコロンも区切りに使う。区切りは最初のコロンだけで、本文のコロンは残す", () => {
    const got = parseDialogue("講師: 開始は 3:00 から。\n生徒：時間は 16：30 です。");
    assert.equal(got[0].speaker, "講師");
    assert.equal(got[0].text, "開始は 3:00 から。");
    assert.equal(got[1].text, "時間は 16：30 です。");
  });

  test("話者名と本文の前後の空白を除く。BOM と CRLF を受け付ける", () => {
    const got = parseDialogue("﻿ 講師 ： 始めよう。 \r\n生徒：はい。\r\n");
    assert.deepEqual(got[0], { line: 1, speaker: "講師", text: "始めよう。" });
    assert.equal(got[1].text, "はい。");
  });

  test("形の合わない行は、行番号を添えてまとめて知らせる", () => {
    assert.throws(
      () => parseDialogue("講師：始めよう。\nコロンの無い行\n：話者の無い行\n生徒："),
      (err: Error) => {
        assert.match(err.message, /2 行目：「話者名：本文」の形になっていません/);
        assert.match(err.message, /3 行目：話者名がありません/);
        assert.match(err.message, /4 行目：本文がありません/);
        return true;
      },
    );
  });

  test("発話が 1 つも無ければ知らせる", () => {
    assert.throws(() => parseDialogue("# 見出しだけ\n\n"), /発話が 1 つもありません/);
  });
});

describe("台本の分け方", () => {
  const u = (line: number, speaker: string, chars: number): Utterance => ({
    line,
    speaker,
    text: "あ".repeat(chars),
  });

  test("上限に収まれば 1 回で送る", () => {
    const chunks = splitIntoChunks([u(1, "講師", 10), u(2, "生徒", 10)], 100);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chars, 20);
    assert.deepEqual(chunks[0].speakers, ["講師", "生徒"]);
  });

  test("発話の切れ目で分け、発話の途中では切らない。順番を保つ", () => {
    const input = [u(1, "講師", 40), u(2, "生徒", 40), u(3, "講師", 40), u(4, "生徒", 40), u(5, "講師", 40)];
    const chunks = splitIntoChunks(input, 100);
    assert.deepEqual(
      chunks.map((c) => c.utterances.map((x) => x.line)),
      [
        [1, 2],
        [3, 4],
        [5],
      ],
    );
    assert.deepEqual(
      chunks.flatMap((c) => c.utterances),
      input,
    );
    for (const c of chunks) assert.ok(c.chars <= 100);
  });

  test("ちょうど上限の文字数までは同じ回に入れる", () => {
    const chunks = splitIntoChunks([u(1, "講師", 60), u(2, "生徒", 40)], 100);
    assert.deepEqual(
      chunks.map((c) => c.chars),
      [100],
    );
  });

  test("回数は前から詰めたときと同じにし、最後の回だけが短く残らないようにそろえる", () => {
    // 前から詰めると 100・100・10 になる台本
    const input = Array.from({ length: 21 }, (_, i) => u(i + 1, i % 2 === 0 ? "講師" : "生徒", 10));
    const chunks = splitIntoChunks(input, 100);
    assert.deepEqual(
      chunks.map((c) => c.chars),
      [70, 70, 70],
    );
  });

  test("どんな台本でも、順番を保ち、上限を守り、回数をいちばん少なくする", () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 200; round++) {
      const maxChars = 20 + Math.floor(random() * 200);
      const speakers = 1 + Math.floor(random() * 14);
      const input = Array.from({ length: 1 + Math.floor(random() * 60) }, (_, i) =>
        u(i + 1, `話者${Math.floor(random() * speakers)}`, 1 + Math.floor(random() * maxChars)),
      );
      const chunks = splitIntoChunks(input, maxChars);
      assert.deepEqual(
        chunks.flatMap((c) => c.utterances),
        input,
      );
      for (const c of chunks) {
        assert.ok(c.utterances.length > 0);
        assert.ok(c.chars <= maxChars);
        assert.equal(c.chars, c.utterances.reduce((s, x) => s + countChars(x.text), 0));
        assert.ok(new Set(c.utterances.map((x) => x.speaker)).size <= MAX_VOICES_PER_REQUEST);
      }
      // 前から上限いっぱいに詰めたときの回数（いちばん少ない回数）と同じ
      let greedy = 0;
      let chars = Infinity;
      let seen = new Set<string>();
      for (const x of input) {
        const n = countChars(x.text);
        const newSpeaker = !seen.has(x.speaker);
        if (chars + n > maxChars || (newSpeaker && seen.size >= MAX_VOICES_PER_REQUEST)) {
          greedy++;
          chars = 0;
          seen = new Set();
        }
        chars += n;
        seen.add(x.speaker);
      }
      assert.equal(chunks.length, greedy);
    }
  });

  test("文字数には演技の指示も数え、サロゲートペアは 1 字と数える", () => {
    assert.equal(countChars("[sighs] はい"), 10);
    assert.equal(countChars("𠮷野"), 2);
    const chunks = splitIntoChunks(
      [
        { line: 1, speaker: "講師", text: "[sighs] はい" },
        { line: 2, speaker: "生徒", text: "𠮷野" },
      ],
      11,
    );
    assert.equal(chunks.length, 2);
  });

  test("1 回に出てくる話者は上限の数まで", () => {
    const input = Array.from({ length: MAX_VOICES_PER_REQUEST + 2 }, (_, i) => u(i + 1, `話者${i}`, 1));
    const chunks = splitIntoChunks(input, 10_000);
    assert.equal(chunks.length, 2);
    for (const c of chunks) assert.ok(c.speakers.length <= MAX_VOICES_PER_REQUEST);
    assert.deepEqual(
      chunks.flatMap((c) => c.speakers),
      input.map((x) => x.speaker),
    );
  });

  test("同じ話者が続くだけなら、話者の数では分けない", () => {
    const input = Array.from({ length: 30 }, (_, i) => u(i + 1, i % 2 === 0 ? "講師" : "生徒", 1));
    assert.equal(splitIntoChunks(input, 10_000).length, 1);
  });

  test("1 発話だけで上限を超えるときは、行番号を添えて知らせる", () => {
    assert.throws(
      () => splitIntoChunks([u(1, "講師", 10), u(7, "生徒", 101)], 100),
      /7 行目（101 字）.*その行を 2 つ以上の行に分けてください/,
    );
  });

  test("上限が正しくなければ知らせる", () => {
    assert.throws(() => splitIntoChunks([u(1, "講師", 1)], 0), /上限が正しくありません/);
  });
});
