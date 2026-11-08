import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { scanText } from "./forbidden-words.mts";
import { buildLedgerEntry, ledgerPath, ledgerTotal, parseLedgerEntry, renderLedgerEntry } from "./score-ledger.mts";
import type { LedgerEntry } from "./score-ledger.mts";
import { SAMPLE_SELF } from "../scripts/memory/sample-self-scores.mts";

const entry = (over: Partial<Parameters<typeof buildLedgerEntry>[0]> = {}): LedgerEntry =>
  buildLedgerEntry({
    interviewId: "student-a-2",
    date: "2025-11-21",
    self: { selfScore: 6, selfNote: "英語は流した。", selfVerdict: "一部" },
    aiItems: [
      { item: 1, score: 3 },
      { item: 5, score: null },
    ],
    aiVerdict: "できた",
    ...over,
  });

describe("点の控え（②。決まり 10・12）", () => {
  test("1 回 1 ファイル。読み返すと同じ中身に戻る", () => {
    const e = entry();
    assert.equal(ledgerPath(e.interviewId, e.date), "/scores/2025-11-21-student-a-2.json");
    assert.deepEqual(parseLedgerEntry(renderLedgerEntry(e)), e);
  });

  test("合計はアプリが計算する。判定しない項目は分母から外す（決まり 8・9）", () => {
    assert.deepEqual(ledgerTotal(entry()), { sum: 3, judgedCount: 1, max: 5, scaled: 6 });
  });

  test("AI の文（判定のなぜ、項目の理由）は持たない", () => {
    const e = buildLedgerEntry({ interviewId: "a", date: "2025-10-24", self: { selfScore: 5, selfNote: "", selfVerdict: null }, aiItems: [{ item: 1, score: 3, reason: "理由の文", utterances: [1] } as never], aiVerdict: null });
    assert.equal(renderLedgerEntry(e).includes("理由の文"), false);
    assert.deepEqual(e.aiItems, [{ item: 1, score: 3 }]);
  });

  test("形の合わない入力と読み返しは通さない", () => {
    assert.throws(() => entry({ self: { selfScore: 11, selfNote: "", selfVerdict: "一部" } }), /1〜10/);
    assert.throws(() => entry({ self: { selfScore: 5, selfNote: "", selfVerdict: null } }), /そろえて/);
    assert.equal(parseLedgerEntry("読めない"), null);
    assert.equal(parseLedgerEntry(JSON.stringify({ interviewId: "a" })), null);
    assert.equal(parseLedgerEntry(JSON.stringify({ ...entry(), aiVerdict: "すごい" })), null);
  });
});

describe("サンプルの自己採点（作ったダミー）", () => {
  const order = ["student-seiseki", "student-yaruki", "student-yaruki-2", "student-seiseki-2"];
  const ai = order.map((id) => {
    const a = JSON.parse(fs.readFileSync(`eval/results/memory/analysis/${id}.json`, "utf8"));
    return ledgerTotal({ aiItems: (a.step4 ?? a.step2).items }).scaled as number;
  });

  test("AI の点との差が、回を追って縮んでいく並びにしない（少ない回数で成長したと言わない）", () => {
    const gaps = order.map((id, i) => Math.abs(SAMPLE_SELF[id].selfScore - ai[i]));
    const shrinking = gaps.every((g, i) => i === 0 || g < gaps[i - 1]);
    assert.equal(shrinking, false, gaps.join(","));
    // 自己採点が回を追って上がっていく並びにもしない
    const selfs = order.map((id) => SAMPLE_SELF[id].selfScore);
    assert.equal(selfs.every((s, i) => i === 0 || s > selfs[i - 1]), false, selfs.join(","));
  });

  test("一言に、人物の性質の言葉が無い（決まり 3）", () => {
    for (const id of order) assert.deepEqual(scanText(SAMPLE_SELF[id].selfNote, id), []);
  });

  test("自己評価は続きの回だけに付く", () => {
    assert.deepEqual(order.map((id) => SAMPLE_SELF[id].selfVerdict !== null), [false, false, true, true]);
  });
});
