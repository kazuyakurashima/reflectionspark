import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { alignScriptToMemo, dropMissingLines, linesForMemoSpan, parseScript } from "./align.mts";

describe("台本とボイスメモの対応付け（軸 11・12 の土台）", () => {
  const script = parseScript(
    [
      "講師：じゃあ、始めようか。今日、部活は？",
      "生徒：今日は早めに終わりました。顧問の先生が出張で。",
      "講師：そっか。吹奏楽、来月が最後のコンクールだっけ。",
      "生徒：はい。それで引退です。",
      "講師：会場はどこ？",
      "生徒：市民会館です。お母さんも聞きに来るって言ってました。",
    ].join("\n"),
  );

  test("聞き違いがあっても、行ごとにボイスメモの範囲が付く", () => {
    const memo = "じゃあ始めようか。今日部活は。今日は早めに終わりました。顧問の先生が出張で。そっか、吹奏楽来月が最後のコンクールだっけ。はい。引退です。会場はどこ市民会館です。お母さんも聞きに来るって言ってました。";
    const a = alignScriptToMemo(script, memo);
    assert.deepEqual(a.missingLines, []);
    for (const l of a.lines) {
      assert.ok(l.memoSpan, `${l.line} 行目に範囲が無い`);
      assert.ok(l.matchRatio >= 0.6, `${l.line} 行目の一致が低い：${l.matchRatio}`);
    }
    // 範囲は順に並ぶ
    for (let i = 1; i < a.lines.length; i++) {
      assert.ok(a.lines[i].memoSpan![0] >= a.lines[i - 1].memoSpan![0]);
    }
  });

  test("ボイスメモから落ちた行は「文字起こしに無い」と印が付く", () => {
    // 5〜6 行目が落ちた
    const memo = "じゃあ始めようか。今日部活は。今日は早めに終わりました。顧問の先生が出張で。そっか、吹奏楽来月が最後のコンクールだっけ。はい。引退です。";
    const a = alignScriptToMemo(script, memo);
    assert.deepEqual(a.missingLines, [5, 6]);
    assert.deepEqual(dropMissingLines([3, 4, 5, 6], a), { kept: [3, 4], dropped: [5, 6] });
  });

  test("ボイスメモの範囲から、重なる台本の行が分かる（話者の正解を引くため）", () => {
    const memo = "じゃあ始めようか。今日部活は。今日は早めに終わりました。顧問の先生が出張で。そっか、吹奏楽来月が最後のコンクールだっけ。はい。引退です。会場はどこ市民会館です。お母さんも聞きに来るって言ってました。";
    const a = alignScriptToMemo(script, memo);
    const start = [...memo].join("").indexOf("今日は早めに");
    const end = start + [..."今日は早めに終わりました。顧問の先生が出張で。"].length;
    const lines = linesForMemoSpan(a, start, end);
    assert.equal(lines[0].line, 2);
  });

  test("台本の読み取りは行番号をファイルの行のままにする", () => {
    const s = parseScript("# 見出し\n\n講師：はい。\n生徒：いいえ。");
    assert.deepEqual(
      s.map((l) => [l.line, l.speaker, l.text]),
      [
        [3, "講師", "はい。"],
        [4, "生徒", "いいえ。"],
      ],
    );
  });
});
