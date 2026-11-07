// 画面の間で持ち回る面談のデータ（localStorage）。認証なしで Demo Mode を成り立たせる。
// 本人の自己採点・自己評価・一言はここに保存するだけで、AI の呼び出しには入れない（決まり 10）。
// localStorage を外部のストアとして useSyncExternalStore で読む（保存すると購読している画面が更新される）。

import { useMemo, useSyncExternalStore } from "react";

import { attachStep0c } from "@/engine/step0.mts";
import type { FollowUpVerdict, MeetingKind, SceneType, Spark, Step0cResult, Step1Result, Step2Result, Step3Result, Step4Result, Transcript } from "@/engine/types.mts";

/** 画面 4 で本人が選んだ（または直した）一つ */
export type SparkChoice = Spark & {
  id: string;
  lines: string[];
  chosenAt: string;
  /** 候補を直して使ったか */
  edited: boolean;
  /** この行動を次の面談で追った回数 */
  timesFollowed: number;
  /** 3 回目に「続ける」と答えたか */
  keepAfterThird: boolean;
};

/** 画面 5（前回のひとつを確かめる）のデータ。確かめるのは、この面談の発話（transcript）と、持ち越したひとつ（prev.spark） */
export type FollowUpData = {
  /** 本人の判定。AI に渡さない */
  selfVerdict: FollowUpVerdict | null;
  result: { step4: Step4Result; mock: boolean } | null;
  /** この結果で追った回数を数えた Spark の id（二重に数えない） */
  countedSparkId: string | null;
};

/** 前の面談から持ち越したもの。「次の面談を始める」で入る（app/lib/next-meeting.mts） */
export type PrevMeeting = {
  /** 前の面談で決めたひとつ（見送ったなら null）。追った回数は、ここで数える */
  spark: SparkChoice | null;
  /** 前の面談そのもの。「前の面談に戻る」と、前回の発言を並べるために持つ。前の前は持たない（prev は null） */
  session: SessionData;
};

export type SessionData = {
  id: string;
  createdAt: string;
  kind: MeetingKind;
  /** 相手の呼び名（記録を相手ごとにつなぐ札） */
  otherName: string;
  /** 初回の面談か（続きの面談なら false。工程 2 に渡す） */
  firstMeeting: boolean;
  /** 貼った文字起こし（そのまま） */
  raw: string;
  /** サンプルの印。「サンプルを選ぶ」で立て、貼る欄の文を書き換えたら外す（app/lib/demo-flag.mts） */
  demo: boolean;
  /** 整形の結果（本人が画面 1 で直した後） */
  transcript: Transcript | null;
  /** 仮の出力か */
  mock: boolean;
  /** 整形にかかった時間 */
  step0Ms: number | null;
  /** 本人の自己採点（10 点満点）と一言。AI に渡さない */
  selfScore: number | null;
  selfNote: string;
  /** 画面 2：場面ごとの自分の見立て（任意）。AI に渡さない */
  ownViews: string[];
  analysis: { step1: Step1Result; step2: Step2Result; mock: boolean } | null;
  /** 画面 3：問いへの本人の答え */
  answers: { question: string; answer: string }[];
  /** 画面 4：候補と、選んだ一つ */
  candidates: { step3: Step3Result; mock: boolean } | null;
  spark: SparkChoice | null;
  sparkSkipped: boolean;
  /** 画面 5：持ち越したひとつを、この面談で確かめた結果 */
  followUp: FollowUpData | null;
  /** 前の面談（あれば）。面談は 1 回ごとに「1 入力」から始め、決めたひとつだけを持ち越す */
  prev: PrevMeeting | null;
};

const KEY = "reflectionspark:session";
const listeners = new Set<() => void>();

export function newSession(kind: MeetingKind = "生徒", otherName = "", raw = ""): SessionData {
  return {
    id: `${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    kind,
    otherName,
    firstMeeting: true,
    raw,
    demo: false,
    transcript: null,
    mock: false,
    step0Ms: null,
    selfScore: null,
    selfNote: "",
    ownViews: [],
    analysis: null,
    answers: [],
    candidates: null,
    spark: null,
    sparkSkipped: false,
    followUp: null,
    prev: null,
  };
}

export function newFollowUp(): FollowUpData {
  return { selfVerdict: null, result: null, countedSparkId: null };
}

/** 古い保存に無い項目を埋める。前の面談が無い保存の確かめ（古い形）は捨てる */
function fill(s: Partial<SessionData>): SessionData {
  const prev = s.prev?.session ? { spark: s.prev.spark ?? null, session: fill({ ...s.prev.session, prev: null }) } : null;
  const f = prev && s.followUp ? { selfVerdict: s.followUp.selfVerdict ?? null, result: s.followUp.result ?? null, countedSparkId: s.followUp.countedSparkId ?? null } : null;
  return { ...newSession(), ...s, answers: s.answers ?? [], ownViews: s.ownViews ?? [], sparkSkipped: s.sparkSkipped ?? false, firstMeeting: s.firstMeeting ?? true, demo: s.demo === true, followUp: f, prev } as SessionData;
}

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function loadSession(): SessionData | null {
  const s = read();
  if (!s) return null;
  try {
    return fill(JSON.parse(s) as Partial<SessionData>);
  } catch {
    return null;
  }
}

export function saveSession(s: SessionData): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 保存できなくても画面は続ける
  }
  listeners.forEach((l) => l());
}

/** 今のセッション（無ければ新しいもの）に手を入れて保存する */
export function updateSession(fn: (s: SessionData) => SessionData): SessionData {
  const next = fn(loadSession() ?? newSession());
  saveSession(next);
  return next;
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** セッションを読む。サーバー側（描画の最初）は undefined、ブラウザで無ければ null。 */
export function useSession(): SessionData | null | undefined {
  const raw = useSyncExternalStore(subscribe, read, () => undefined);
  return useMemo(() => {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    try {
      return fill(JSON.parse(raw) as Partial<SessionData>);
    } catch {
      return null;
    }
  }, [raw]);
}

/** 0c（意味が通らない箇所）を別に呼び、届いたら同じ発話の並びにだけ付ける。失敗や遅れで画面を止めない */
export async function fetchStep0c(transcript: Transcript, apply: (fn: (t: Transcript) => Transcript) => void): Promise<void> {
  try {
    const r = await fetch("/api/step0c", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript }) });
    const d = (await r.json()) as { step0c?: Step0cResult; utteranceCount?: number; error?: string };
    if (!r.ok || !d.step0c) return;
    const count = d.utteranceCount ?? transcript.utterances.length;
    apply((t) => (t.raw === transcript.raw ? attachStep0c(t, d.step0c as Step0cResult, count) : t));
  } catch {
    // 推測なしのまま
  }
}

/** 選んだ一つの id（候補の番号と時刻から） */
export function makeSparkId(i: number): string {
  return `${Date.now().toString(36)}-${i}`;
}

/** 工程 3 に渡す、本人の答えの文。答えのある問いだけを並べる */
export function answerText(s: SessionData): string {
  return questionsOf(s)
    .map((q) => ({ q, a: s.answers.find((x) => x.question === q)?.answer.trim() ?? "" }))
    .filter((x) => x.a !== "")
    .map((x) => `問い：${x.q}\n答え：${x.a}`)
    .join("\n\n");
}

/** 画面 3 の問い（場面ごとの問いと、事情を尋ねる問い） */
export function questionsOf(s: SessionData): string[] {
  return questionItemsOf(s).map((x) => x.q);
}

/** 画面 3 の問いと、どこから来た問いか（場面の種類。事情を尋ねる問いは null） */
export function questionItemsOf(s: SessionData): { q: string; from: SceneType | null }[] {
  const a = s.analysis;
  if (!a) return [];
  const qs: { q: string; from: SceneType | null }[] = a.step1.scenes.filter((sc) => sc.question.trim() !== "").map((sc) => ({ q: sc.question, from: sc.type }));
  if (a.step1.extraQuestion) qs.push({ q: a.step1.extraQuestion, from: null });
  return qs;
}
