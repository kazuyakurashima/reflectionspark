import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { step4UserText } from "../../engine/prompts.mts";
import type { Spark } from "../../engine/types.mts";
import { comparePair, conditionPairs, meanScore, selfEvaluationNote } from "./sycophancy.mts";
import type { RunSummary } from "./sycophancy.mts";

const run = (verdict: RunSummary["verdict"], quoteIndices: number[], scores: (number | null)[]): RunSummary => ({ verdict, quoteIndices, scores });

describe("軸 7：迎合の検査（決まり 10）", () => {
  test("決まり 10：本番の工程 4 の本文に、本人の自己評価は入らない", () => {
    const spark = { sentence: "もし差があったら、聞く。", criterion: null, previousScene: null } as unknown as Spark;
    const text = step4UserText("生徒", spark);
    assert.ok(!text.includes("自己評価"));
    assert.ok(!text.includes("本人の一言"));
  });

  test("なしは何も添えない。甘いと厳しいは自己評価と点を添え、指示は付けない", () => {
    assert.equal(selfEvaluationNote("なし"), "");
    assert.ok(selfEvaluationNote("甘い").includes("できた"));
    assert.ok(selfEvaluationNote("甘い").includes("5、5、5、5、5"));
    assert.ok(selfEvaluationNote("厳しい").includes("まだ"));
    assert.ok(selfEvaluationNote("厳しい").includes("1、1、1、1、1"));
    assert.ok(!selfEvaluationNote("甘い").includes("無視"));
  });

  test("判定・根拠の発話・点の同じ所を数える。根拠の順番は問わない", () => {
    const p = comparePair(run("できた", [3, 9], [4, 4, 5, 5, 4]), run("できた", [9, 3], [4, 3, 5, 5, null]), ["なし", "甘い"]);
    assert.equal(p.verdictSame, true);
    assert.equal(p.quotesSame, true);
    assert.equal(p.quotesOverlap, true);
    assert.equal(p.scoresSame, 3);
  });

  test("判定が違えば不一致。重なりと完全な一致は分ける", () => {
    const p = comparePair(run("できた", [3, 9], [1, 1, 1, 1, 1]), run("一部", [9, 12], [1, 1, 1, 1, 1]), ["甘い", "厳しい"]);
    assert.equal(p.verdictSame, false);
    assert.equal(p.quotesSame, false);
    assert.equal(p.quotesOverlap, true);
  });

  test("3 条件から 3 組を作る（3 本で 9 組）", () => {
    const r = run("まだ", [1], [2, 2, 2, 2, 2]);
    const pairs = conditionPairs({ なし: r, 甘い: r, 厳しい: r });
    assert.deepEqual(pairs.map((p) => [p.a, p.b]), [["なし", "甘い"], ["なし", "厳しい"], ["甘い", "厳しい"]]);
    assert.ok(pairs.every((p) => p.verdictSame));
  });

  test("点の平均は、判定しないを数えない", () => {
    assert.equal(meanScore([4, null, 2]), 3);
    assert.equal(meanScore([null, null]), null);
  });
});
