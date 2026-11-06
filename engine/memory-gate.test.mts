import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkCorrectionKept, dreamBlockers, hasIndexLine, indexProblems, nextRecordStep, sessionIdsForDream, storedProblems } from "./memory-gate.mts";
import type { SessionEntry } from "./memory-gate.mts";
import { checkStoredRecord } from "./recorder.mts";

const ids = ["a-1", "a-2", "a-3"];
const ok = (sessionId: string): SessionEntry => ({ sessionId, listCostMinor: null, verified: true, problems: [] });

describe("保存の検査を、後ろの工程を止める条件にする（工程 5・6）", () => {
  test("次にすること：済みは飛ばす。セッションと記録があれば確かめ直す。無ければセッションを回す", () => {
    assert.equal(nextRecordStep(ok("s1"), true), "skip");
    assert.equal(nextRecordStep({ sessionId: "s1", listCostMinor: null, verified: false }, true), "check");
    // 以前の控えには verified が無い。済みとして飛ばさない
    assert.equal(nextRecordStep({ sessionId: "s1", listCostMinor: null }, true), "check");
    assert.equal(nextRecordStep({ sessionId: "s1", listCostMinor: null, verified: false }, false), "session");
    assert.equal(nextRecordStep(undefined, false), "session");
    assert.equal(nextRecordStep(undefined, true), "session");
  });

  test("読み返しの結果から、済みにできない理由を並べる", () => {
    const md = "# 記録\n- 観察：講師は様子を尋ねた。\n";
    assert.deepEqual(storedProblems(checkStoredRecord([{ id: "m", path: "/records/a-1.md", content: md }], "a-1", md), true), []);
    assert.deepEqual(storedProblems(checkStoredRecord([], "a-1", md), true), ["記録のファイルが無い"]);
    assert.deepEqual(storedProblems(checkStoredRecord([{ id: "m", path: "/records/a-1.md", content: "# 違う\n" }], "a-1", md), false), ["渡した文と違う（1 行目）", "索引に行が無い"]);
    const named = checkStoredRecord([{ id: "m", path: "/records/a-1.md", content: `${md}- 話しすぎる癖がある。\n- たなかの話。\n` }], "a-1", `${md}- 話しすぎる癖がある。\n- たなかの話。\n`, ["たなか"]);
    assert.deepEqual(storedProblems(named, true), ["性質の言葉が 2 件", "名前が 1 件"]);
  });

  test("索引の全体：見出しと渡した行だけ、同じ順番のときに合う", () => {
    const h = "# 索引";
    assert.deepEqual(indexProblems("# 索引\n- 1\n- 2\n", h, ["- 1", "- 2"]), []);
    assert.deepEqual(indexProblems("# 索引\n- 1\n", h, ["- 1", "- 2"]), ["足りない行が 1 行"]);
    assert.deepEqual(indexProblems("# 索引\n- 1\n- 2\n- 3\n", h, ["- 1", "- 2"]), ["余分な行が 1 行"]);
    assert.deepEqual(indexProblems("# 索引\n- 2\n- 1\n", h, ["- 1", "- 2"]), ["行の順番が違う"]);
    assert.equal(hasIndexLine("# 索引\n- 1\n", "- 1"), true);
    assert.equal(hasIndexLine("# 索引\n- 12\n", "- 1"), false);
  });

  test("夢の開始条件：全部の面談の保存を確かめ、索引も合っていること。ID がそろっているだけでは始めない", () => {
    const all = { "a-1": ok("s1"), "a-2": ok("s2"), "a-3": ok("s3") };
    assert.deepEqual(dreamBlockers(ids, all, true), []);
    assert.deepEqual(dreamBlockers(ids, all, false), ["索引：合っていると確かめていない"]);
    assert.deepEqual(dreamBlockers(ids, { ...all, "a-2": { sessionId: "s2", listCostMinor: null } }, true), ["a-2：保存の検査に通っていない（検査の記録が無い）"]);
    assert.deepEqual(dreamBlockers(ids, { ...all, "a-2": { sessionId: "s2", listCostMinor: null, verified: false, problems: ["渡した文と違う（3 行目）"] } }, true), ["a-2：保存の検査に通っていない（渡した文と違う（3 行目））"]);
    assert.equal(dreamBlockers(ids, undefined, true).length, 4 - 1);
  });
});

describe("本人の訂正を守る（決まり 12）", () => {
  const sessions = { "a-1": ok("s1"), "a-2": ok("s2"), "a-3": ok("s3") };

  test("直した記録のセッションは夢に渡さない。全部を外すことになれば止める", () => {
    assert.deepEqual(sessionIdsForDream(ids, sessions, []), { sessionIds: ["s1", "s2", "s3"], excluded: [] });
    assert.deepEqual(sessionIdsForDream(ids, sessions, ["a-2"]), { sessionIds: ["s1", "s3"], excluded: ["a-2"] });
    assert.throws(() => sessionIdsForDream(ids, sessions, ids), /1 本も無い/);
  });

  test("夢の出力で、直した文が残り、前の文が戻っていないかを確かめる", () => {
    const c = { interviewId: "a-1", oldText: "前の文。", newText: "直した文。" };
    const kept = checkCorrectionKept(
      [
        { id: "1", path: "/records/a-1.md", content: "- 観察：直した文。\n" },
        { id: "2", path: "/recurring-scenes.md", content: "> 〔発話 1〕講師：前の文。\n- 説明：別の文。\n" },
      ],
      [c],
    );
    assert.equal(kept[0].kept, true);
    const revived = checkCorrectionKept([{ id: "1", path: "/records/a-1.md", content: "- 観察：前の文。\n" }], [c]);
    assert.deepEqual([revived[0].kept, revived[0].newTextInRecord, revived[0].oldTextInRecord], [false, false, true]);
    const elsewhere = checkCorrectionKept(
      [
        { id: "1", path: "/records/a-1.md", content: "- 観察：直した文。\n" },
        { id: "2", path: "/recurring-scenes.md", content: "- 説明：前の文。\n" },
      ],
      [c],
    );
    assert.deepEqual([elsewhere[0].kept, elsewhere[0].oldTextElsewhere], [false, ["/recurring-scenes.md"]]);
  });
});
