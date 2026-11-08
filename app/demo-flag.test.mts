// サンプルの印と、記録（Memory）の発話の見せ方の橋渡し。
// 記録にあるのはサンプルの講師の記録なので、貼った面談には添えない（別の人の発言が「あなたの言葉」になるため）。
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import type { PreviousWords } from "../engine/types.mts";
import { candidatesBody, demoAfterInput } from "./lib/demo-flag.mts";
import { sameInput, sameTranscript } from "./lib/input-guard.mts";
import { tooltipPlace } from "./lib/tooltip-place.mts";
import { formatDate, kindOfSpeakers, linesTranscript, mergeLines, previousLines, recordScoreCells } from "./lib/record-view.mts";

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

describe("遅れて届いた応答で、貼った面談に印が移らない", () => {
  type S = { id: string; raw: string; kind: string; demo: boolean; transcript: { raw: string; utterances: { speaker: string; text: string | null }[] } | null };
  const pasted = (): S => ({ id: "A", raw: "貼った文", kind: "生徒", demo: false, transcript: null });
  const sample = (): S => ({ id: "B", raw: "サンプルの文", kind: "生徒", demo: true, transcript: null });
  const formatted = { raw: "貼った文", utterances: [{ speaker: "講師", text: "貼った文" }] };
  /** 画面 1 と同じ判定：頼んだ時と同じ入力のときだけ整形の結果を保存する */
  const saveFormat = (stamp: { id: string; raw: string; kind: string }, s: S): S => (sameInput(stamp, s) ? { ...s, transcript: formatted } : s);

  it("サンプル → 整形の順に届いても、貼った文の整形結果はサンプルのセッションに入らない", () => {
    const start = pasted();
    const stamp = { id: start.id, raw: start.raw, kind: start.kind };
    const after = saveFormat(stamp, sample());
    assert.equal(after.transcript, null);
    assert.equal(after.raw, "サンプルの文");
    assert.equal(after.demo, true);
  });

  it("整形 → サンプルの順なら、サンプルが残る。待つ間に貼り直したら結果を捨てる", () => {
    const start = pasted();
    const stamp = { id: start.id, raw: start.raw, kind: start.kind };
    assert.equal(saveFormat(stamp, start).transcript, formatted);
    assert.equal(saveFormat(stamp, { ...start, raw: "貼り直した文" }).transcript, null);
    assert.equal(saveFormat(stamp, { ...start, kind: "保護者" }).transcript, null);
  });

  it("候補や分析は、同じ発言の並びのときだけ保存する。0c の有無は問わない", () => {
    assert.equal(sameTranscript(formatted, { ...formatted, step0c: {} } as typeof formatted), true);
    assert.equal(sameTranscript(formatted, { raw: "別の文", utterances: formatted.utterances }), false);
    assert.equal(sameTranscript(formatted, { raw: formatted.raw, utterances: [{ speaker: "生徒", text: "貼った文" }] }), false);
    assert.equal(sameTranscript(formatted, { raw: formatted.raw, utterances: [{ speaker: "講師", text: "直した文" }] }), false);
    assert.equal(sameTranscript(formatted, null), false);
  });

  it("画面のつなぎ：応答の保存の前に照合している", () => {
    const page1 = fs.readFileSync("app/page.tsx", "utf8");
    assert.match(page1, /if \(!now \|\| !sameInput\(stamp, now\)\) return;/);
    assert.match(page1, /s\.raw === raw \? \{ \.\.\.newSession\(d\.kind, d\.otherName, d\.raw\), demo: true \} : s/);
    assert.match(page1, /disabled=\{busy \|\| loadingDemo \|\| raw\.trim\(\) === ""\}/);
    for (const f of ["app/reflection/page.tsx", "app/spark/page.tsx", "app/next/page.tsx"]) assert.match(fs.readFileSync(f, "utf8"), /sameTranscript\(/, f);
    assert.match(fs.readFileSync("app/spark/page.tsx", "utf8"), /now\.demo !== session\.demo/);
  });
});

describe("発言の説明の位置", () => {
  it("画面の端に 16px の余白を残して収める", () => {
    // 390px の画面：幅は 320、右に寄った番号では左へずらす
    assert.deepEqual(tooltipPlace(200, 390), { width: 320, shift: -146 });
    assert.deepEqual(tooltipPlace(20, 390), { width: 320, shift: 0 });
    // 画面より説明が広くなるときは、幅を縮める
    assert.deepEqual(tooltipPlace(100, 300), { width: 268, shift: -84 });
    // 広い画面では番号にそろえる
    assert.deepEqual(tooltipPlace(600, 1456), { width: 320, shift: 0 });
    for (const [left, vw] of [[0, 390], [389, 390], [120, 320], [1400, 1456]]) {
      const p = tooltipPlace(left, vw);
      assert.ok(left + p.shift >= 16 && left + p.shift + p.width <= vw - 16, `${left}/${vw}`);
    }
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

describe("記録の画面の点数（決まり 8）", () => {
  const show = (c: ReturnType<typeof recordScoreCells>) => c.map((x) => `${x.label}=${x.value}${x.unit ?? ""}`);

  it("1 回目の回は、自分の点数と AI の合計を並べる", () => {
    assert.deepEqual(show(recordScoreCells({ selfScore: 6, selfVerdict: null, aiScaled: 7, aiVerdict: null })), ["自分の点数=6／10", "AI の点数（合計）=7／10"]);
    assert.deepEqual(show(recordScoreCells({ selfScore: 6, selfVerdict: null, aiScaled: null, aiVerdict: null })), ["自分の点数=6／10", "AI の点数（合計）=—／10"]);
  });

  it("続きの回は AI の合計を出さず、自分の判定と AI の判定を並べる（記録の AI の点は前の作りの画面 5 の点のため）", () => {
    const cells = recordScoreCells({ selfScore: 6, selfVerdict: "一部", aiScaled: 6.4, aiVerdict: "まだ" });
    assert.deepEqual(show(cells), ["自分の点数=6／10", "自分の判定=一部", "AI の判定=まだ"]);
    assert.ok(!cells.some((c) => c.value === "6.4"));
  });

  it("続きの回で片方の判定が無ければ、その欄は出さない", () => {
    assert.deepEqual(show(recordScoreCells({ selfScore: 5, selfVerdict: null, aiScaled: 6.8, aiVerdict: "できた" })), ["自分の点数=5／10", "AI の判定=できた"]);
  });
});
