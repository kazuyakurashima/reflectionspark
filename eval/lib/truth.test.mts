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

  test("12 本の正解が読め、5 項目と場面がそろっている", () => {
    const cases = listTruthCases();
    assert.deepEqual(cases, [
      "coaching",
      "parent",
      "student-seiseki",
      "student-seiseki-2",
      "student-shinro",
      "student-shinro-2",
      "student-yaruki",
      "student-yaruki-2",
      "student-youbou",
      "trap-noaction",
      "trap-noevidence",
      "trap-scoreask",
    ]);
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
      for (const k of ["strengthBest", "strengthNext", "issueBest", "issueNext"] as const) {
        const r = t.scenes[k];
        if (r) expandLines(r.lines); // 行の指定が読める
      }
      if (t.noScene) {
        // 根拠のある場面が無いのが正解のときは、場面を一つも置かない（決まり 4）
        for (const k of ["strengthBest", "strengthNext", "issueBest", "issueNext"] as const) assert.equal(t.scenes[k], null, `${c} の ${k}`);
      } else {
        assert.ok(t.scenes.strengthBest, `${c} の強み・いちばん`);
        assert.ok(t.scenes.issueBest, `${c} の課題・いちばん`);
      }
      // 続きの面談は、前回のケースと追跡の正解を持つ（前回の一手を工程 4 に渡すため）
      if (!t.firstMeeting && c !== "coaching") {
        assert.ok(t.followUpOf, `${c} の followUpOf`);
        assert.ok(t.followUp, `${c} の followUp`);
      }
    }
  });

  test("続きの面談の追跡の正解（決まり 5・軸 6）", () => {
    assert.equal(loadTruth("student-yaruki-2").followUp?.verdict, "まだ");
    assert.equal(loadTruth("student-seiseki-2").followUp?.verdict, "一部");
    const noaction = loadTruth("trap-noaction");
    assert.equal(noaction.followUp?.verdict, "場面がなかった");
    assert.equal(noaction.followUp?.evidenceLines, null);
  });

  test("連絡だけの保護者面談は、場面が無く、5 項目とも「判定しない」（決まり 4・9、軸 8）", () => {
    const t = loadTruth("trap-noevidence");
    assert.ok(t.noScene);
    for (const k of ["1", "2", "3", "4", "5"] as const) assert.equal(t.items[k].mark, "判定しない");
  });

  test("続きの面談には追跡の正解がある（student-shinro-2）", () => {
    const t = loadTruth("student-shinro-2");
    assert.equal(t.followUp?.verdict, "できた");
    assert.deepEqual(expandLines(t.followUp!.evidenceLines), [63]);
    assert.equal(t.followUp?.criterion, null);
  });

  test("初回の面談は項目 5 が「判定しない」（決まり 9）", () => {
    for (const c of listTruthCases().filter((c) => loadTruth(c).firstMeeting)) {
      assert.equal(loadTruth(c).items["5"].mark, "判定しない");
    }
  });
});
