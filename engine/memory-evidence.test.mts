import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { causalHits, counterOverlaps, parseEvidenceRefs, parseHypotheses, summarizeEvidence, summarizeHypotheses, uniqueUtterances, verificationClaims, verifyEvidence } from "./memory-evidence.mts";
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

  test("根拠の数と発話の数を分ける。同じ発話を重ねて数えない。範囲は 1 発話ずつ数える", () => {
    const refs = parseEvidenceRefs(["〔student-a-1｜発話 2〕講師：「a」", "〔student-a-1｜発話 2〕講師：「b」", "〔student-a-1｜発話 2〜3〕「c」", "〔student-b-1｜発話 2〕講師：「d」"].join("\n"));
    assert.equal(refs.length, 4);
    assert.equal(uniqueUtterances(refs), 3);
  });

  test("根拠と反例の両方に挙げた発話を見つける（同じ発話は反例にならない）", () => {
    const [h] = parseHypotheses(`## 仮説 H4：案を示した直後の発話は短い
- 根拠：
  - 〔student-a-1｜発話 1〕生徒：「正直、ほぼゼロです。」
  - 〔student-a-1｜発話 3〕生徒：「……はい。」
- 例外・反例：
  - 〔student-a-1｜発話 3〕生徒：「……はい。」
  - 〔student-b-1｜発話 1〕生徒：「上げたいです。」
`);
    assert.deepEqual(counterOverlaps(h), ["student-a-1 発話 3"]);
  });

  test("夢自身の文から、原因を言い切る言い方と「照合した」という言葉の候補を探す。発話の本文と「」の中は数えない", () => {
    const md = [
      "- 説明：受け止めを確認すると、相手の話が続いた。",
      "- 説明：受け止めが効いた。",
      "- 説明：発話 40 の次に、発話 41 があった。",
      "> 〔発話 1〕講師：そうすると、どうなる。",
      "- 〔student-a-1｜発話 0〕講師：「やってみると効いたよ。」",
      "- 説明：「すると」は発話の言葉。",
      "metadata: 引用は一字照合済み",
    ].join("\n");
    assert.deepEqual(causalHits(md).map((h) => [h.line, h.word]), [[1, "すると"], [2, "効いた"]]);
    assert.deepEqual(verificationClaims(md).map((h) => [h.line, h.word]), [[7, "一字照合"]]);
  });
});

describe("記録係と夢の呼び出しの、純粋な部分", () => {
  test("夢への指示は 4,096 字までで、ファイルの名前・根拠の形・性質の言葉の禁止・暫定の明記が入っている", () => {
    const t = dreamInstructions(6);
    assert.equal([...t].length <= 4096, true);
    for (const s of ["index.md", "recurring-scenes.md", "changes.md", "actions.md", "〔面談ID｜発話 n〕話者：「引用」", "例外・反例", "確からしさ", "保留", "暫定", "書き換えない"]) assert.equal(t.includes(s), true, s);
  });

  test("決まり 10：夢への指示に、点と判定の言葉が無い", () => {
    const t = dreamInstructions(4);
    assert.equal(t.includes("判定"), false);
    assert.equal(/面談の点|点の上下|自己採点|自己評価/.test(t), false);
  });

  test("夢への指示：出所ごとの読み方、順番だけ書くこと、反例の読み替えの禁止、本人の訂正", () => {
    const t = dreamInstructions(6);
    for (const s of ["「>」の行だけが発話の本文", "AI の文で、事実ではない", "起きた順番だけを書く", "原因を言い切らない", "形の違う場面を 1 つの仮説にまとめず", "書いたあとで条件や言葉を読み替えない", "根拠に挙げた発話を反例に挙げない", "測った数字ではない", "corrected", "前の文を戻さない", "「照合済み」と書かない"]) assert.equal(t.includes(s), true, s);
  });

  test("記録係に送る文には、記録の本文がそのまま入る", () => {
    const md = "# 面談の記録：student-a-1\n\n> 〔発話 2〕講師：大丈夫、これからだよ。\n";
    const m = recorderMessage("student-a-1", "2025-10-24", md, "- records/2025-10-24-student-a-1.md｜1 本目");
    assert.equal(m.includes(`<record>\n${md.trimEnd()}\n</record>`), true);
    assert.equal(m.includes("メモリストアの records/2025-10-24-student-a-1.md"), true);
    assert.equal(m.includes("<index_line>\n- records/2025-10-24-student-a-1.md｜1 本目\n</index_line>"), true);
  });

  test("読み返した記録が渡した文と同じかを確かめ、違えば最初に違った行を返す", () => {
    const md = "# 記録\n- 観察：講師は様子を尋ねた。\n> 〔発話 2〕講師：そっか。\n";
    const same = checkStoredRecord([{ id: "m1", path: "/records/2025-10-24-student-a-1.md", content: md.trimEnd() }], "student-a-1", "2025-10-24", md);
    assert.equal(same.identical, true);
    assert.equal(same.check?.ok, true);
    const changed = checkStoredRecord([{ id: "m1", path: "/records/2025-10-24-student-a-1.md", content: md.replace("そっか。", "そうか。") }], "student-a-1", "2025-10-24", md);
    assert.equal(changed.identical, false);
    assert.deepEqual(changed.firstDiff, { line: 3, expected: "> 〔発話 2〕講師：そっか。", actual: "> 〔発話 2〕講師：そうか。" });
    assert.equal(checkStoredRecord([], "student-a-1", "2025-10-24", md).found, false);
  });

  test("使用量をそろえ、入力トークンの量に換算する", () => {
    const u = usageOf({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 0 }, list_cost: { amount: "12" } });
    assert.deepEqual(u, { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000, cacheWriteTokens: 400, activeSeconds: null, listCostMinor: "12" });
    assert.equal(inputEquivalentTokens(u), 1000 + 500 + 500 + 1000);
    assert.equal(usageOf(null).inputTokens, 0);
  });
});
