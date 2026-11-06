import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseEvidenceRefs, parseHypotheses, summarizeEvidence, summarizeHypotheses, verifyEvidence } from "./memory-evidence.mts";
import { checkStoredRecord, dreamInstructions, inputEquivalentTokens, recorderMessage, usageOf } from "./recorder.mts";
import type { Utterance } from "./types.mts";

const make = (texts: string[]): Utterance[] => texts.map((t, i) => ({ index: i, speaker: i % 2 === 0 ? "講師" : "生徒", text: t, original: t, confidence: "高" as const, check: [], memoSpan: null }));

const transcripts: Record<string, Utterance[]> = {
  "student-a-1": make(["家ではどのくらいやってる。", "正直、ほぼゼロです。", "大丈夫、これからだよ。夏から頑張ろう。", "……はい。"]),
  "student-b-1": make(["点数、どうしたい。", "上げたいです。", "まずは冬期講習で頑張ろう。", "はい。"]),
};

describe("夢の出力の根拠を原文と照合する（決まり 1）", () => {
  test("根拠の行から、面談 ID・発話番号・話者・引用を読む。全角の数字と範囲も読む", () => {
    const refs = parseEvidenceRefs(["- 〔student-a-1｜発話 2〕講師：「大丈夫、これからだよ。夏から頑張ろう。」", "説明の行。発話 2 は数えない", "  - 〔student-b-1|発話２〜３〕「はい。」", "| 表 | 〔student-a-1｜発話 1〕生徒：「正直、ほぼゼロです。」 | 〔student-b-1｜発話 1〕 |"].join("\n"));
    assert.deepEqual(
      refs.map((r) => [r.interviewId, r.index, r.lastIndex, r.speaker, r.quote, r.line]),
      [
        ["student-a-1", 2, 2, "講師", "大丈夫、これからだよ。夏から頑張ろう。", 1],
        ["student-b-1", 2, 3, null, "はい。", 3],
        ["student-a-1", 1, 1, "生徒", "正直、ほぼゼロです。", 4],
        ["student-b-1", 1, 1, null, null, 4],
      ],
    );
  });

  test("引用の中に「」があっても、最後の」までを引用として読む", () => {
    const [r] = parseEvidenceRefs("- 〔student-a-1｜発話 0〕講師：「先生は「大丈夫」って言ったよね。」");
    assert.equal(r.quote, "先生は「大丈夫」って言ったよね。");
  });

  test("照合：全文一致、一部一致、記号だけ違う、番号ちがい、面談ちがい、不一致、範囲の外、面談が無い、引用なし", () => {
    const md = [
      "〔student-a-1｜発話 2〕講師：「大丈夫、これからだよ。夏から頑張ろう。」", // 全文一致
      "〔student-a-1｜発話 2〕講師：「夏から頑張ろう。」", // 一部一致
      "〔student-a-1｜発話 2〕講師：「大丈夫これからだよ 夏から頑張ろう」", // 記号だけ違う
      "〔student-a-1｜発話 3〕講師：「大丈夫、これからだよ。夏から頑張ろう。」", // 番号ちがい（話者も違う）
      "〔student-a-1｜発話 2〕講師：「まずは冬期講習で頑張ろう。」", // 面談ちがい
      "〔student-a-1｜発話 2〕講師：「きっと受かるよ。」", // 不一致
      "〔student-a-1｜発話 9〕講師：「大丈夫、これからだよ。」", // 範囲の外
      "〔student-z-1｜発話 0〕講師：「家ではどのくらいやってる。」", // 面談が無い
      "〔student-b-1｜発話 1〕", // 引用なし
    ].join("\n");
    const checks = verifyEvidence(parseEvidenceRefs(md), transcripts);
    assert.deepEqual(
      checks.map((c) => c.status),
      ["全文一致", "一部一致", "記号だけ違う", "番号ちがい", "面談ちがい", "不一致", "範囲の外", "面談が無い", "引用なし"],
    );
    assert.deepEqual(checks[3].foundAt, [{ interviewId: "student-a-1", index: 2 }]);
    assert.equal(checks[3].speakerMatches, false);
    assert.deepEqual(checks[4].foundAt, [{ interviewId: "student-b-1", index: 2 }]);
    assert.deepEqual(checks[0].actual, [{ speaker: "講師", text: "大丈夫、これからだよ。夏から頑張ろう。" }]);
    const s = summarizeEvidence(checks);
    assert.equal(s.total, 9);
    assert.equal(s.matched, 2);
    assert.equal(s.withQuote, 8);
    assert.equal(s.speakerMismatch, 1);
  });

  test("仮説ごとに、確からしさ・根拠・例外や反例を読む。反例が発話つきか、文だけか、空かを数える", () => {
    const md = `暫定（検証用の記録から作った。本人は確かめていない）

# 繰り返す場面

## 仮説 H1：相手が今の状況を話した直後に、励ましへ進む場面が 2 回あった
- 確からしさ：中
- 場面の形：相手が、できていないことを話したとき
- 根拠：
  - 〔student-a-1｜発話 2〕講師：「大丈夫、これからだよ。夏から頑張ろう。」
  - 〔student-b-1｜発話 2〕講師：「まずは冬期講習で頑張ろう。」
- 例外・反例：
  - 〔student-a-1｜発話 0〕講師：「家ではどのくらいやってる。」
- まだ分からないこと：ほかの相手でも同じか

## 仮説 H2：短い返事のあとに、次の話題へ進む場面があった
- 確からしさ：保留（1 回だけ）
- 根拠：
  - 〔student-b-1｜発話 3〕生徒：「はい。」
- 例外・反例：この記録の範囲には見当たらない

## 仮説 H3：例外の欄が無い仮説
- 確からしさ：低
- 根拠：
  - 〔student-a-1｜発話 3〕生徒：「……はい。」

## 別の見出し
- 根拠：
  - 〔student-a-1｜発話 1〕生徒：「正直、ほぼゼロです。」
`;
    const hs = parseHypotheses(md);
    assert.deepEqual(hs.map((h) => [h.id, h.confidence, h.evidence.length, h.counter.length, h.interviews.length]), [
      ["H1", "中", 2, 1, 2],
      ["H2", "保留", 1, 0, 1],
      ["H3", "低", 1, 0, 1],
    ]);
    assert.equal(hs[1].counterNote, "この記録の範囲には見当たらない");
    assert.deepEqual(summarizeHypotheses(hs), { total: 3, withCounterEvidence: 1, withCounterNoteOnly: 1, withoutCounter: 1, acrossInterviews: 1, byConfidence: { 中: 1, 保留: 1, 低: 1 } });
  });
});

describe("記録係と夢の呼び出しの、純粋な部分", () => {
  test("夢への指示は 4,096 字までで、ファイルの名前・根拠の形・性質の言葉の禁止・暫定の明記が入っている", () => {
    const t = dreamInstructions(6);
    assert.equal([...t].length <= 4096, true);
    for (const s of ["index.md", "recurring-scenes.md", "changes.md", "actions.md", "〔面談ID｜発話 n〕話者：「引用」", "例外・反例", "確からしさ", "保留", "暫定", "書き換えない"]) assert.equal(t.includes(s), true, s);
  });

  test("記録係に送る文には、記録の本文がそのまま入る", () => {
    const md = "# 面談の記録：student-a-1\n\n> 〔発話 2〕講師：大丈夫、これからだよ。\n";
    const m = recorderMessage("student-a-1", md, "- records/student-a-1.md｜1 本目");
    assert.equal(m.includes(`<record>\n${md.trimEnd()}\n</record>`), true);
    assert.equal(m.includes("メモリストアの records/student-a-1.md"), true);
    assert.equal(m.includes("<index_line>\n- records/student-a-1.md｜1 本目\n</index_line>"), true);
  });

  test("読み返した記録が渡した文と同じかを確かめ、違えば最初に違った行を返す", () => {
    const md = "# 記録\n- 観察：講師は様子を尋ねた。\n> 〔発話 2〕講師：そっか。\n";
    const same = checkStoredRecord([{ id: "m1", path: "/records/student-a-1.md", content: md.trimEnd() }], "student-a-1", md);
    assert.equal(same.identical, true);
    assert.equal(same.check?.ok, true);
    const changed = checkStoredRecord([{ id: "m1", path: "/records/student-a-1.md", content: md.replace("そっか。", "そうか。") }], "student-a-1", md);
    assert.equal(changed.identical, false);
    assert.deepEqual(changed.firstDiff, { line: 3, expected: "> 〔発話 2〕講師：そっか。", actual: "> 〔発話 2〕講師：そうか。" });
    assert.equal(checkStoredRecord([], "student-a-1", md).found, false);
  });

  test("使用量をそろえ、入力トークンの量に換算する", () => {
    const u = usageOf({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 0 }, list_cost: { amount: "12" } });
    assert.deepEqual(u, { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000, cacheWriteTokens: 400, activeSeconds: null, listCostMinor: "12" });
    assert.equal(inputEquivalentTokens(u), 1000 + 500 + 500 + 1000);
    assert.equal(usageOf(null).inputTokens, 0);
  });
});
