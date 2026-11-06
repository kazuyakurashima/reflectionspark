// サンプルの印と、記録（Memory）の発話の見せ方の橋渡し。
// 記録にあるのはサンプルの講師の記録なので、貼った面談には添えない（別の人の発言が「あなたの言葉」になるため）。
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import type { PreviousWords } from "../engine/types.mts";
import { candidatesBody, demoAfterInput } from "./lib/demo-flag.mts";
import { formatDate, kindOfSpeakers, linesTranscript, mergeLines, previousLines } from "./lib/record-view.mts";

describe("サンプルの印", () => {
  it("印が無いとき、画面 4 は demo を送らない（貼った面談に、サンプルの講師の記録を添えない）", () => {
    const body = candidatesBody({ transcript: { kind: "生徒" }, scene: { type: "次に試せる所" }, answer: "a", demo: false });
    assert.equal("demo" in body, false);
    assert.equal(JSON.parse(JSON.stringify(body)).demo, undefined);
  });

  it("印があるときだけ demo: true を送る。真でない値は印として扱わない", () => {
    assert.equal(candidatesBody({ transcript: 1, scene: 2, answer: "", demo: true }).demo, true);
    // 古い保存や壊れた保存で、真偽値でないものが入っていても送らない
    assert.equal("demo" in candidatesBody({ transcript: 1, scene: 2, answer: "", demo: "true" as unknown as boolean }), false);
    assert.equal("demo" in candidatesBody({ transcript: 1, scene: 2, answer: "", demo: undefined as unknown as boolean }), false);
  });

  it("貼る欄の文を書き換えたら印を外す。場面の種類や呼び名では外さない", () => {
    assert.equal(demoAfterInput(true, { raw: "書き換えた文" }), false);
    assert.equal(demoAfterInput(true, { raw: "" }), false);
    assert.equal(demoAfterInput(true, {}), true);
    assert.equal(demoAfterInput(false, {}), false);
    assert.equal(demoAfterInput(false, { raw: "貼った文" }), false);
  });

  it("画面のつなぎ：サンプルを選ぶと印を立て、入力を変えたら demoAfterInput を通し、画面 4 は candidatesBody で送る", () => {
    // コメントの行は見ない（コードだけを見る）
    const code = (file: string) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\/?\*|\{\/\*)/.test(l))
        .join("\n");
    const page1 = code("app/page.tsx");
    assert.match(page1, /newSession\(d\.kind, d\.otherName, d\.raw\), demo: true/);
    assert.match(page1, /demo: demoAfterInput\(s\.demo, patch\)/);
    // 発言の直し（update・split）は印に触らない
    const edits = page1.slice(page1.indexOf("const update = "), page1.indexOf("const goNext = "));
    assert.ok(edits.includes("splitUtterance"));
    assert.doesNotMatch(edits, /demo/);
    const page4 = code("app/spark/page.tsx");
    assert.match(page4, /JSON\.stringify\(candidatesBody\(\{ transcript, scene: nextScene, answer, demo: session\.demo \}\)\)/);
    assert.doesNotMatch(page4, /demo: true/);
    const session = fs.readFileSync("app/lib/session.ts", "utf8");
    assert.match(session, /demo: false,/);
    assert.match(session, /demo: s\.demo === true/);
  });
});

describe("記録の発話を、画面 2 の部品に渡す形にする", () => {
  const p: PreviousWords = {
    date: "2025-10-24",
    otherTag: "相手 B",
    before: { index: 11, speaker: "生徒", text: "もう嫌いになりそうです。" },
    own: { index: 12, speaker: "講師", text: "嫌いになりそうか。" },
    after: { index: 13, speaker: "生徒", text: "前は割と好きだったんです。" },
    interviewId: "student-b",
    utterance: 12,
  };

  it("直前 → 本人 → 直後の順に、原文のまま並べる（決まり 1）", () => {
    assert.deepEqual(
      previousLines(p).map((l) => `${l.index}:${l.speaker}:${l.text}`),
      ["11:生徒:もう嫌いになりそうです。", "12:講師:嫌いになりそうか。", "13:生徒:前は割と好きだったんです。"],
    );
    const t = linesTranscript(kindOfSpeakers(p.own.speaker, ["生徒"]), previousLines(p));
    assert.deepEqual(
      t.utterances.map((u) => u.text),
      previousLines(p).map((l) => l.text),
    );
    assert.ok(t.utterances.every((u) => u.text === u.original));
  });

  it("直前や直後が記録に無ければ、その行は出さない", () => {
    assert.deepEqual(
      previousLines({ ...p, before: null }).map((l) => l.index),
      [12, 13],
    );
    assert.deepEqual(
      previousLines({ ...p, before: null, after: null }).map((l) => l.index),
      [12],
    );
  });

  it("話者の呼び名から、本人の側（右）を決める", () => {
    assert.equal(kindOfSpeakers("講師", ["生徒"]), "生徒");
    assert.equal(kindOfSpeakers("講師", ["保護者"]), "保護者");
    assert.equal(kindOfSpeakers("コーチ", ["クライアント"]), "コーチング");
    assert.equal(kindOfSpeakers("講師"), "生徒");
  });

  it("引用と前後の発話を番号の順に並べ、日付を読みやすくする", () => {
    assert.deepEqual(
      mergeLines([{ index: 5, speaker: "講師", text: "q" }], [{ index: 6, speaker: "生徒", text: "n" }, { index: 4, speaker: "生徒", text: "m" }, { index: 5, speaker: "講師", text: "dup" }]).map((l) => `${l.index}${l.text}`),
      ["4m", "5q", "6n"],
    );
    assert.equal(formatDate("2025-10-24"), "2025 年 10 月 24 日");
    assert.equal(formatDate("2026-07-08"), "2026 年 7 月 8 日");
    assert.equal(formatDate("去年の秋"), "去年の秋");
  });
});
