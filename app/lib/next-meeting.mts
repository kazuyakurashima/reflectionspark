// 次の面談への持ち越し。AI を呼ばない。
// 面談は 1 回ごとに「1 入力」から始める。前の面談で決めたひとつは次の面談に持ち越し、
// 次の面談を整形したあと、読む（画面 2）の前に確かめる。入口は「1 入力」の一つだけ。
// 前の面談は 1 つだけ持つ（前の前は持たない）。保存はブラウザの中だけなので、量を増やさない。

import type { SessionData, SparkChoice } from "./session.ts";

/** 上の帯の段。n は番号（確かめは番号を持たない） */
export type FlowStep = { href: string; label: string; n: number | null };

// 問いへの答えは「2 読む」の中で書く（11/8 に、前の「3 問いに答える」を 2 に入れた）
const STEPS: FlowStep[] = [
  { href: "/", label: "入力", n: 1 },
  { href: "/reflection", label: "読む", n: 2 },
  { href: "/spark", label: "次に試すひとつ", n: 3 },
];

/** 上の帯の段は 1〜3。持ち越したひとつがあるときだけ、1 と 2 の間に確かめが入る */
export function flowSteps(hasCheck: boolean): FlowStep[] {
  return hasCheck ? [STEPS[0], { href: "/next", label: "前回の確かめ", n: null }, ...STEPS.slice(1)] : STEPS;
}

/** 同じ相手との続きの面談か。呼び名が前の面談と同じ（空でない）ときだけ */
export function isContinuation(prevName: string | null | undefined, name: string): boolean {
  const a = (prevName ?? "").trim();
  return a !== "" && a === name.trim();
}

/** 読み方（初回か続きか）が変わったら、読みと後の工程を消す（項目 5 を判定するかが変わるため）。整形・確かめ・自分の点は残す */
function withFirstMeeting(s: SessionData, first: boolean): SessionData {
  if (s.firstMeeting === first) return s;
  return { ...s, firstMeeting: first, analysis: null, ownViews: [], answers: [], candidates: null, spark: null, sparkSkipped: false };
}

/** 相手の呼び名を変える。前の面談と同じ呼び名なら、続きの面談として読む。前の面談が無ければ初回のまま */
export function withOtherName(s: SessionData, name: string): SessionData {
  const next = { ...s, otherName: name };
  return s.prev ? withFirstMeeting(next, !isContinuation(s.prev.session.otherName, name)) : next;
}

/** 次の面談へ持ち越す（画面 3 の「今日はここまでにする」）。fresh は新しい空のセッション。決めたひとつ（見送ったなら null）と、前の面談そのものを持ち越す */
export function startNextMeeting(s: SessionData, fresh: SessionData): SessionData {
  return { ...fresh, kind: s.kind, firstMeeting: true, prev: { spark: s.spark, session: { ...s, prev: null } } };
}

/** 前の面談に戻る（次の面談の入力は捨てる） */
export function backToPrevMeeting(s: SessionData): SessionData {
  return s.prev ? s.prev.session : s;
}

/** 持ち越しをやめる（今の入力は残す）。前の面談とのつながりが無くなるので、確かめを消し、初回の面談として読む */
export function dropPrev(s: SessionData): SessionData {
  return withFirstMeeting({ ...s, prev: null, followUp: null }, true);
}

/** 整形のあとの行き先。持ち越したひとつがあれば、読む前に確かめる */
export function afterFormatHref(s: Pick<SessionData, "prev"> | null | undefined): string {
  return s?.prev?.spark ? "/next" : "/reflection";
}

/** 画面 1 に出すサンプルの入口。前の面談がサンプルなら続き、貼った面談なら出さない（貼った面談にサンプルをつながない） */
export function sampleEntry(s: Pick<SessionData, "prev"> | null | undefined): "first" | "next" | "none" {
  if (!s?.prev) return "first";
  return s.prev.session.demo ? "next" : "none";
}

/** 画面 3 で「前回のひとつを続ける」と決めたときの一つ。追った回数と、決めた面談の場面はそのまま持つ */
export function keptSpark(prevSpark: SparkChoice, now: string): SparkChoice {
  return { ...prevSpark, chosenAt: now, keepAfterThird: prevSpark.timesFollowed >= 3 };
}
