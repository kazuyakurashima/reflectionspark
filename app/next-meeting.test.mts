// 次の面談への持ち越し。面談は 1 回ごとに「1 入力」から始め、決めたひとつだけを持ち越して、読む前に確かめる。
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import type { SessionData, SparkChoice } from "./lib/session.ts";
import { afterFormatHref, backToPrevMeeting, dropPrev, flowSteps, isContinuation, keptSpark, sampleEntry, startNextMeeting, withOtherName } from "./lib/next-meeting.mts";

const spark = (id: string, timesFollowed = 0): SparkChoice =>
  ({ id, sentence: `もし${id}なら、聞く`, criterion: "問いが一つ出る", lines: [], previousScene: null, chosenAt: "2026-06-19", edited: false, timesFollowed, keepAfterThird: false }) as SparkChoice;

const session = (over: Partial<SessionData> = {}): SessionData =>
  ({
    id: "s1",
    createdAt: "2026-06-19",
    kind: "生徒",
    otherName: "Aさん",
    firstMeeting: true,
    raw: "貼った文",
    demo: false,
    transcript: { raw: "貼った文", kind: "生徒", utterances: [] },
    mock: false,
    step0Ms: 1,
    selfScore: 7,
    selfNote: "一言",
    ownViews: ["見方"],
    analysis: { step1: {}, step2: {}, mock: false },
    answers: [{ question: "q", answer: "a" }],
    candidates: { step3: {}, mock: false },
    spark: spark("a"),
    sparkSkipped: false,
    followUp: null,
    prev: null,
    ...over,
  }) as unknown as SessionData;

const fresh = (): SessionData => session({ id: "s2", otherName: "", raw: "", transcript: null, analysis: null, answers: [], candidates: null, spark: null, selfScore: null, selfNote: "", ownViews: [] });

describe("上の帯の段", () => {
  it("段は 1〜3。持ち越したひとつがあるときだけ、1 と 2 の間に番号の無い確かめが入る", () => {
    assert.deepEqual(
      flowSteps(false).map((s) => `${s.n}:${s.href}`),
      ["1:/", "2:/reflection", "3:/spark"],
    );
    assert.deepEqual(
      flowSteps(true).map((s) => `${s.n}:${s.href}`),
      ["1:/", "null:/next", "2:/reflection", "3:/spark"],
    );
    // 「5 次の面談で」を段の終わりに置かない
    assert.ok(flowSteps(true).every((s) => s.href !== "/next" || s.n === null));
  });
});

describe("次の面談へ持ち越す（画面 3 の「今日はここまでにする」）", () => {
  it("決めたひとつと前の面談を持ち越し、入力は空、サンプルの印は外れ、初回として読む", () => {
    const s1 = session({ demo: true });
    const s2 = startNextMeeting(s1, fresh());
    assert.equal(s2.raw, "");
    assert.equal(s2.transcript, null);
    assert.equal(s2.demo, false);
    assert.equal(s2.firstMeeting, true);
    assert.equal(s2.kind, "生徒");
    assert.equal(s2.otherName, "");
    assert.equal(s2.prev?.spark?.id, "a");
    assert.equal(s2.prev?.session.id, "s1");
    assert.equal(s2.prev?.session.demo, true);
  });

  it("前の前は持たない（量を増やさない）。見送った面談からは、ひとつ無しで持ち越す", () => {
    const s1 = session();
    const s2 = startNextMeeting(s1, fresh());
    const s3 = startNextMeeting({ ...s2, spark: null, sparkSkipped: true }, { ...fresh(), id: "s3" });
    assert.equal(s3.prev?.spark, null);
    assert.equal(s3.prev?.session.id, "s2");
    assert.equal(s3.prev?.session.prev, null);
  });

  it("前の面談に戻ると、その面談がそのまま戻る", () => {
    const s1 = session();
    const back = backToPrevMeeting(startNextMeeting(s1, fresh()));
    assert.equal(back.id, "s1");
    assert.equal(back.spark?.id, "a");
    assert.equal(back.analysis, s1.analysis);
    assert.equal(backToPrevMeeting(s1), s1);
  });
});

describe("続きの面談として読むか", () => {
  it("呼び名が前の面談と同じ（空でない）ときだけ続き", () => {
    assert.equal(isContinuation("Aさん", "Aさん"), true);
    assert.equal(isContinuation("Aさん", " Aさん "), true);
    assert.equal(isContinuation("Aさん", "Bさん"), false);
    assert.equal(isContinuation("", ""), false);
    assert.equal(isContinuation(null, "Aさん"), false);
  });

  it("呼び名を変えると読み方が変わり、読みと後の工程を消す。整形・確かめ・自分の点は残す", () => {
    const s2 = { ...startNextMeeting(session(), fresh()), transcript: { raw: "次", kind: "生徒", utterances: [] }, followUp: { selfVerdict: "一部", result: null, countedSparkId: null }, selfScore: 6, analysis: { step1: {} } } as unknown as SessionData;
    const same = withOtherName(s2, "Aさん");
    assert.equal(same.firstMeeting, false);
    assert.equal(same.analysis, null);
    assert.equal(same.transcript, s2.transcript);
    assert.equal(same.followUp, s2.followUp);
    assert.equal(same.selfScore, 6);
    const other = withOtherName({ ...same, analysis: { step1: {} } } as unknown as SessionData, "Bさん");
    assert.equal(other.firstMeeting, true);
    assert.equal(other.analysis, null);
    // 読み方が変わらなければ、読みは消さない
    const still = withOtherName({ ...same, analysis: { step1: {} } } as unknown as SessionData, "Aさん ");
    assert.notEqual(still.analysis, null);
  });

  it("前の面談が無ければ、呼び名は札として変わるだけ", () => {
    const s = withOtherName(session(), "Bさん");
    assert.equal(s.otherName, "Bさん");
    assert.equal(s.firstMeeting, true);
    assert.notEqual(s.analysis, null);
  });

  it("持ち越しをやめると、確かめが消え、初回として読む", () => {
    const s2 = { ...startNextMeeting(session(), fresh()), firstMeeting: false, followUp: { selfVerdict: "できた", result: null, countedSparkId: null } } as unknown as SessionData;
    const d = dropPrev(s2);
    assert.equal(d.prev, null);
    assert.equal(d.followUp, null);
    assert.equal(d.firstMeeting, true);
  });
});

describe("入口と行き先", () => {
  it("整形のあと、持ち越したひとつがあれば確かめへ、無ければ読むへ", () => {
    assert.equal(afterFormatHref(session()), "/reflection");
    assert.equal(afterFormatHref(startNextMeeting(session(), fresh())), "/next");
    assert.equal(afterFormatHref(startNextMeeting({ ...session(), spark: null }, fresh())), "/reflection");
    assert.equal(afterFormatHref(null), "/reflection");
  });

  it("サンプルの入口：前の面談が無ければ最初から、サンプルなら続き、貼った面談なら出さない", () => {
    assert.equal(sampleEntry(session()), "first");
    assert.equal(sampleEntry(startNextMeeting(session({ demo: true }), fresh())), "next");
    assert.equal(sampleEntry(startNextMeeting(session({ demo: false }), fresh())), "none");
  });

  it("前回のひとつを続けると、同じ id と追った回数のまま持ち帰る", () => {
    const k = keptSpark(spark("a", 3), "2026-07-28");
    assert.equal(k.id, "a");
    assert.equal(k.timesFollowed, 3);
    assert.equal(k.keepAfterThird, true);
    assert.equal(k.chosenAt, "2026-07-28");
    assert.equal(keptSpark(spark("a", 1), "x").keepAfterThird, false);
  });
});

describe("画面のつなぎ", () => {
  const code = (file: string) =>
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/?\*|\{\/\*)/.test(l))
      .join("\n");

  it("上の帯は next-meeting の段を使い、「5 次の面談で」を持たない", () => {
    const nav = code("app/components/StepNav.tsx");
    assert.match(nav, /flowSteps\(Boolean\(session\?\.prev\?\.spark\)\)/);
    assert.doesNotMatch(nav, /次の面談で/);
  });

  it("画面 1：整形のあとの行き先は afterFormatHref。サンプルの続きでも、持ち越しは残す", () => {
    const page1 = code("app/page.tsx");
    assert.match(page1, /router\.push\(afterFormatHref\(session\)\)/);
    assert.match(page1, /fetch\(sample === "next" \? "\/api\/demo\/2" : "\/api\/demo"\)/);
    assert.match(page1, /s\.raw === raw && s\.prev \? withOtherName\(/);
    // 入力を変えても、持ち越し（prev）は消さない
    const cleared = page1.slice(page1.indexOf("const cleared"), page1.indexOf("export default function"));
    assert.doesNotMatch(cleared, /prev/);
  });

  it("画面 3：選ぶ・見送るでこの面談の確かめを消さない。終わりは「今日はここまでにする」", () => {
    const page4 = code("app/spark/page.tsx");
    assert.doesNotMatch(page4, /followUp: null/);
    assert.match(page4, /startNextMeeting\(s, newSession\(s\.kind\)\)/);
    assert.doesNotMatch(page4, /router\.push\("\/next"\)/);
    // AI の判定は、本人の判定の後にだけ出す
    assert.match(page4, /check\?\.result && check\.selfVerdict &&/);
  });

  it("画面 4：確かめるのは今回の発話と持ち越したひとつ。貼る欄・整形・点の表は置かない", () => {
    const page5 = code("app/next/page.tsx");
    assert.match(page5, /const spark = prev\?\.spark \?\? null;/);
    assert.match(page5, /const transcript = session\?\.transcript \?\? null;/);
    assert.match(page5, /now\.prev\?\.spark\?\.id !== spark\.id/);
    for (const banned of ["/api/step0", "textarea", "ScoreTable", "selfScore"]) assert.ok(!page5.includes(banned), banned);
  });
});
