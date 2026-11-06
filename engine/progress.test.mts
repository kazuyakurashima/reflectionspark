// 待つ間の進み具合は、途中の出力から数えた本当の量だけを届ける（engine/progress.mts）。API は呼ばない。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { copiedChars, countChars, labeledSentences, rawPositions, scoredItems, step1Phase, throttled } from "./progress.mts";
import type { ProgressEvent } from "./progress.mts";

describe("待つ間の進み具合を数える", () => {
  it("0a（copy）：途中で切れた出力から、写し終えた本文の字数を数える（空白と理由の文は数えない）", () => {
    const full = JSON.stringify({
      utterances: [
        { speaker: "講師", text: "じゃあ 始めようか。", confidence: "高", reason: "\"text\": と書いてあっても数えない" },
        { speaker: "生徒", text: "はい。\nお願いします。", confidence: "高", reason: "" },
      ],
    });
    assert.equal(copiedChars(full), countChars("じゃあ始めようか。はい。お願いします。"));
    // 2 つ目の本文の途中で切れても、そこまでを数える
    const cut = full.slice(0, full.indexOf("お願い") + 2);
    assert.equal(copiedChars(cut), countChars("じゃあ始めようか。はい。お願"));
    assert.equal(copiedChars(""), 0);
    assert.equal(copiedChars('{"utterances":[{"speaker":"講師","te'), 0);
  });

  it("0a（copy）：途中で切れたエスケープは、完成するまで数えない。字数は減らない", () => {
    const head = '{"text":"あ';
    const seen = ["\\", "\\u", "\\u3", "\\u30", "\\u304", "\\u3042"].map((tail) => copiedChars(head + tail));
    assert.deepEqual(seen, [1, 1, 1, 1, 1, 2]);
    // サロゲートは 2 つで 1 字
    assert.equal(copiedChars('{"text":"\\ud83d'), 0);
    assert.equal(copiedChars('{"text":"\\ud83d\\ude00'), 1);
    // 空白のエスケープは数えない。そのほかのエスケープは 1 字
    assert.equal(copiedChars('{"text":"あ\\n\\u3000\\u0020い\\"う\\\\"'), 5);
    // 「\\u30」は、エスケープされた \\ と u と 3 と 0 で、4 字
    assert.equal(copiedChars('{"text":"\\\\u30'), 4);
  });

  it("写し終えた字数を、元の文（空白を含む）の何字目かに直す", () => {
    const w = rawPositions("あい\nう えお");
    assert.equal(w.total, 7);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(w.at), [0, 1, 2, 4, 6, 7, 7]);
  });

  it("0a（label）：話者を付けた文の数を数え、reasons と splits の n は数えない", () => {
    const full = JSON.stringify({ sentences: [{ n: 0, speaker: "講師", confidence: "高" }, { n: 1, speaker: "生徒", confidence: "高" }], reasons: [{ n: 1, reason: "r" }], splits: [{ n: 1, at: "a" }] });
    assert.equal(labeledSentences(full), 2);
    assert.equal(labeledSentences(full.slice(0, full.indexOf('"n":1') + 5)), 2);
    assert.equal(labeledSentences('{"sentences":[{"n":0,"spea'), 1);
  });

  it("工程 1：いま書いている所（読んでいる／場面 1／場面 2／まとめ）", () => {
    assert.equal(step1Phase(""), 0);
    assert.equal(step1Phase('<scene type="よく表れた所">\n<context>'), 1);
    assert.equal(step1Phase('<scene type="よく表れた所">…</scene>\n<scene type="次に試せる所">'), 2);
    assert.equal(step1Phase("<scene>…</scene><scene>…</scene>\n<summary>"), 3);
    assert.equal(step1Phase("<no_scene>根拠になる発話が無い</no_scene>"), 3);
  });

  it("工程 2：点を付け終えた項目の数（書き始めた項目は数えない。ethics が出たら全部）", () => {
    const item = (n: number) => `{"item":${n},"judged":true,"score":3,"reason":"r","utterances":[2]}`;
    assert.equal(scoredItems('{"items":['), 0);
    assert.equal(scoredItems(`{"items":[${item(1).slice(0, 20)}`), 0);
    assert.equal(scoredItems(`{"items":[${item(1)},${item(2)},{"item":3,"judg`), 2);
    assert.equal(scoredItems(`{"items":[${[1, 2, 3, 4, 5].map(item).join(",")}],"insight_owner":"講`), 5);
  });

  it("同じ中身を続けて届けない。工程が変われば届ける。最後まで進んだら必ず届ける", () => {
    const got: ProgressEvent[] = [];
    const send = throttled((e) => got.push(e), 10);
    send({ stage: "0a" });
    send({ stage: "0a", done: 0, total: 100, unit: "字" });
    send({ stage: "0a", done: 4, total: 100, unit: "字" });
    send({ stage: "0a", done: 12, total: 100, unit: "字" });
    send({ stage: "0a", done: 95, total: 100, unit: "字" });
    send({ stage: "0a", done: 100, total: 100, unit: "字" });
    send({ stage: "0a", done: 100, total: 100, unit: "字" });
    send({ stage: "0b" });
    assert.deepEqual(
      got.map((e) => `${e.stage}:${e.done ?? "-"}`),
      ["0a:-", "0a:0", "0a:12", "0a:95", "0a:100", "0b:-"],
    );
  });
});

describe("工程 0 が進み具合を届ける（API は呼ばない）", () => {
  it("0a の途中の字数と、0a → 0b の切り替わりが届く", async () => {
    process.env.ANTHROPIC_API_KEY ??= "test";
    const { setClientForTests } = await import("./claude.mts");
    const { runStep0 } = await import("./step0.mts");
    const raw = "じゃあ始めようか。\nはい。 お願いします。";
    const text0a = JSON.stringify({
      utterances: [
        { speaker: "講師", text: "じゃあ始めようか。", confidence: "高", reason: "" },
        { speaker: "生徒", text: "はい。お願いします。", confidence: "高", reason: "" },
      ],
      multiple_others: false,
      multiple_others_reason: "",
    });
    const texts = [text0a, JSON.stringify({ corrections: [] })];
    let call = 0;
    // 出力を 7 字ずつ届ける偽のクライアント
    setClientForTests({
      messages: {
        stream() {
          const text = texts[call++];
          let onText: ((d: string) => void) | null = null;
          const s = {
            on(name: string, fn: (d: string) => void) {
              if (name === "text") onText = fn;
              return s;
            },
            finalMessage: async () => {
              for (let i = 0; i < text.length; i += 7) onText?.(text.slice(i, i + 7));
              return { content: [{ type: "text", text }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1, output_tokens: 1 } };
            },
          };
          return s;
        },
      },
    });
    const stages: string[] = [];
    const counts: number[] = [];
    let total = 0;
    const r = await runStep0(raw, "生徒", {
      onStage: (s) => stages.push(s),
      onProgress: (done, t) => {
        counts.push(done);
        total = t;
      },
    });
    assert.equal(r.transcript.utterances.length, 2);
    assert.deepEqual(stages, ["0a", "0b"]);
    // 全体の字数は、入力欄と同じく空白を含めて数える
    assert.equal(total, [...raw].length);
    assert.equal(counts.at(-1), total);
    assert.ok(counts.some((n) => n > 0 && n < total));
    assert.ok(counts.every((n, i) => i === 0 || n >= counts[i - 1]));
  });
});
