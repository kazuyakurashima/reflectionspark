import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { expandLines, isVerified, listTruthCases, loadTruth } from "./truth.mts";

describe("正解の読み取り（eval/truth）", () => {
  test("行の指定を行番号の並びにする", () => {
    assert.deepEqual(expandLines("101-117"), Array.from({ length: 17 }, (_, i) => 101 + i));
    assert.deepEqual(expandLines([61, 101, "139-141"]), [61, 101, 139, 140, 141]);
    assert.deepEqual(expandLines([21, 45, 47]), [21, 45, 47]);
    assert.equal(expandLines(null), null);
  });

  test("「案」は作り手が確かめた所と分ける", () => {
    assert.equal(isVerified("作り手"), true);
    assert.equal(isVerified("決め"), true);
    assert.equal(isVerified("案"), false);
  });

  test("4 本の正解が読め、5 項目と場面がそろっている", () => {
    const cases = listTruthCases();
    assert.deepEqual(cases, ["coaching", "parent", "student-shinro", "student-shinro-2"]);
    for (const c of cases) {
      const t = loadTruth(c);
      assert.equal(t.version, "v1");
      for (const k of ["1", "2", "3", "4", "5"] as const) {
        const it = t.items[k];
        assert.ok(it, `${c} の項目 ${k} が無い`);
        if (it.mark === "判定しない") {
          assert.equal(it.good, null);
          assert.equal(it.bad, null);
        }
        if (it.mark === "○") assert.ok(it.good);
        if (it.mark === "×") assert.ok(it.bad);
        if (it.mark === "○×") assert.ok(it.good && it.bad);
      }
      assert.ok(t.scenes.strengthBest);
      assert.ok(t.scenes.issueBest);
    }
  });

  test("続きの面談には追跡の正解がある（student-shinro-2）", () => {
    const t = loadTruth("student-shinro-2");
    assert.equal(t.followUp?.verdict, "できた");
    assert.deepEqual(expandLines(t.followUp!.evidenceLines), [63]);
    assert.equal(t.followUp?.criterion, null);
  });

  test("初回の面談は項目 5 が「判定しない」（決まり 9）", () => {
    for (const c of ["student-shinro", "parent"]) {
      assert.equal(loadTruth(c).items["5"].mark, "判定しない");
    }
  });
});
