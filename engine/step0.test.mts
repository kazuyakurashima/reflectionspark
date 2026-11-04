import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { anchorUtterances, applyCorrections, CHECK_CORRECTED, CHECK_LOW_CONFIDENCE, CHECK_UNANCHORED } from "./step0.mts";
import type { Step0aRaw, Utterance } from "./types.mts";

const raw = "じゃあ始めようか。今日部活は。今日は早めに終わりました。顧問の先生が出張で。そっか、吹奏楽来月が最後のコンクールだっけ。はいあ、ごめん会場はどこ市民会館です。";

function parsed(utts: Step0aRaw["utterances"], multiple = false): Step0aRaw {
  return { utterances: utts, multipleOthers: multiple };
}

describe("工程 0a：区切りと話者を元の文に当て直す（言葉を変えない）", () => {
  test("モデルが写した本文が元と少し違っても、発話の本文は元の文字起こしの切り出しになる", () => {
    const { utterances, unanchored } = anchorUtterances(
      raw,
      parsed([
        { speaker: "講師", text: "じゃあ、始めようか。今日、部活は？", confidence: "高", reason: "" },
        { speaker: "生徒", text: "今日は早めに終わりました。顧問の先生が出張で。", confidence: "高", reason: "" },
        { speaker: "講師", text: "そっか、吹奏楽来月が最後のコンクールだっけ。", confidence: "高", reason: "" },
        { speaker: "生徒", text: "はい", confidence: "中", reason: "" },
        { speaker: "講師", text: "あ、ごめん会場はどこ", confidence: "低", reason: "二人の言葉がくっついている" },
        { speaker: "生徒", text: "市民会館です。", confidence: "高", reason: "" },
      ]),
      "生徒",
    );
    assert.equal(unanchored, 0);
    assert.equal(utterances.length, 6);
    assert.equal(utterances[0].original, "じゃあ始めようか。今日部活は。");
    assert.equal(utterances[1].original, "今日は早めに終わりました。顧問の先生が出張で。");
    assert.equal(utterances[3].original, "はい");
    assert.equal(utterances[4].original, "あ、ごめん会場はどこ");
    assert.equal(utterances[5].original, "市民会館です。");
    // 全文を発話で覆う
    assert.equal(utterances.map((u) => u.original).join(""), raw.replace(/\s/g, ""));
    assert.deepEqual(utterances[4].check, [CHECK_LOW_CONFIDENCE]);
    assert.equal(utterances[0].index, 0);
    assert.deepEqual(utterances[0].memoSpan, [0, [..."じゃあ始めようか。今日部活は。"].length]);
  });

  test("当て直せない発話は前の発話にくっつけず、「区切りが分からない所」として別の発話に残す", () => {
    const { utterances, unanchored } = anchorUtterances(
      raw,
      parsed([
        { speaker: "講師", text: "じゃあ始めようか。今日部活は。", confidence: "高", reason: "" },
        { speaker: "生徒", text: "まったく別の文章です", confidence: "高", reason: "" },
        { speaker: "講師", text: "そっか、吹奏楽来月が最後のコンクールだっけ。", confidence: "高", reason: "" },
      ]),
      "生徒",
    );
    assert.equal(unanchored, 1);
    assert.equal(utterances.length, 4);
    // 前の発話は自分の範囲だけ
    assert.equal(utterances[0].original, "じゃあ始めようか。今日部活は。");
    assert.deepEqual(utterances[0].check, []);
    // 当たらなかった元の文は別の発話。モデルの区切りの話者を仮に付け、確からしさは低、印を付ける
    assert.equal(utterances[1].original, "今日は早めに終わりました。顧問の先生が出張で。");
    assert.equal(utterances[1].speaker, "生徒");
    assert.equal(utterances[1].confidence, "低");
    assert.ok(utterances[1].check.some((c) => c.startsWith(CHECK_UNANCHORED)));
    assert.equal(utterances[2].original, "そっか、吹奏楽来月が最後のコンクールだっけ。");
    // 末尾の、モデルの出力に無かった所も別の発話
    assert.equal(utterances[3].original, "はいあ、ごめん会場はどこ市民会館です。");
    assert.ok(utterances[3].check.some((c) => c.startsWith(CHECK_UNANCHORED)));
    // 全文を発話で覆う
    assert.equal(utterances.map((u) => u.original).join(""), raw.replace(/\s/g, ""));
  });

  test("数文字の残りは区切りのずれとみなし、前の発話に含める", () => {
    const { utterances } = anchorUtterances(
      "じゃあ始めようか。今日部活は。ね。今日は早めに終わりました。",
      parsed([
        { speaker: "講師", text: "じゃあ始めようか。今日部活は。", confidence: "高", reason: "" },
        { speaker: "生徒", text: "今日は早めに終わりました。", confidence: "高", reason: "" },
      ]),
      "生徒",
    );
    assert.equal(utterances.length, 2);
    assert.equal(utterances[0].original, "じゃあ始めようか。今日部活は。ね。");
    assert.equal(utterances[1].original, "今日は早めに終わりました。");
  });

  test("話者ラベルが 2 つのどちらでもなければ、相手に寄せて印を付ける", () => {
    const { utterances } = anchorUtterances(raw, parsed([{ speaker: "先生", text: "じゃあ始めようか。", confidence: "高", reason: "" }]), "生徒");
    assert.equal(utterances[0].speaker, "生徒");
    assert.ok(utterances[0].check.length > 0);
  });
});

describe("工程 0b：直しの当て方（設計書の決まり）", () => {
  const make = (): Utterance[] =>
    [
      "4月の面談シートに第一志望は難航って書いてくれてたよね。",
      "変わってないです。南航には行きたいです。",
      "はいはい。",
    ].map((t, i) => ({ index: i, speaker: i === 1 ? "生徒" : "講師", text: t, original: t, confidence: "高" as const, check: [], memoSpan: null }));

  test("ちょうど 1 か所ある直しだけ当て、元の文は残す", () => {
    const u = make();
    const r = applyCorrections(u, [
      { index: 0, kind: "同音の取り違え", before: "難航", after: "南高" },
      { index: 1, kind: "同音の取り違え", before: "南航", after: "南高" },
    ]);
    assert.equal(r.applied.length, 2);
    assert.equal(r.discarded.length, 0);
    assert.equal(u[0].text, "4月の面談シートに第一志望は南高って書いてくれてたよね。");
    assert.equal(u[0].original, "4月の面談シートに第一志望は難航って書いてくれてたよね。");
    assert.deepEqual(u[0].check, [CHECK_CORRECTED]);
  });

  test("空・変化なし・改行・範囲外・無い・2 か所以上は捨て、理由を残す", () => {
    const u = make();
    const r = applyCorrections(u, [
      { index: 0, kind: "x", before: "", after: "南高" },
      { index: 0, kind: "x", before: "難航", after: "難航" },
      { index: 0, kind: "x", before: "難航", after: "南\n高" },
      { index: 9, kind: "x", before: "難航", after: "南高" },
      { index: 0, kind: "x", before: "北高", after: "南高" },
      { index: 2, kind: "x", before: "はい", after: "いや" },
    ]);
    assert.equal(r.applied.length, 0);
    assert.deepEqual(
      r.discarded.map((d) => d.reason),
      ["直す前が空", "何も変わらない", "改行が入っている", "発話番号が範囲の外", "直す前の文字列がその発話に無い", "直す前の文字列がその発話に 2 か所以上ある"],
    );
    assert.equal(u[0].text, u[0].original);
  });

  test("同じ発話の 2 件目は、1 件目を当てた後の文で確かめる", () => {
    const u = make();
    const r = applyCorrections(u, [
      { index: 0, kind: "x", before: "難航", after: "南高" },
      { index: 0, kind: "x", before: "南高って", after: "南高と" },
      { index: 0, kind: "x", before: "難航", after: "南高" },
    ]);
    assert.equal(r.applied.length, 2);
    assert.equal(r.discarded[0].reason, "直す前の文字列がその発話に無い");
    assert.equal(u[0].text, "4月の面談シートに第一志望は南高と書いてくれてたよね。");
  });
});
