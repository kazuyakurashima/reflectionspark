// 画面の間で持ち回る面談のデータ（localStorage）。認証なしで Demo Mode を成り立たせる。
// 本人の自己採点・自己評価・一言はここに保存するだけで、AI の呼び出しには入れない（決まり 10）。
// localStorage を外部のストアとして useSyncExternalStore で読む（保存すると購読している画面が更新される）。

import { useMemo, useSyncExternalStore } from "react";

import { attachStep0c } from "@/engine/step0.mts";
import type { FollowUpVerdict, MeetingKind, Spark, Step0cResult, Step1Result, Step2Result, Step3Result, Step4Result, Transcript } from "@/engine/types.mts";

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

/** 画面 5（次の面談で）のデータ */
export type FollowUpData = {
  raw: string;
  transcript: Transcript | null;
  mock: boolean;
  step0Ms: number | null;
  /** 本人の自己評価。AI に渡さない */
  selfVerdict: FollowUpVerdict | null;
  selfScore: number | null;
  result: { step4: Step4Result; mock: boolean } | null;
  /** この結果で追った回数を数えた Spark の id（二重に数えない） */
  countedSparkId: string | null;
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
  /** 整形の結果（本人が画面 1 で直した後） */
  transcript: Transcript | null;
  /** 仮の出力か */
  mock: boolean;
  /** 整形にかかった時間 */
  step0Ms: number | null;
  /** 本人の自己採点（10 点満点）と一言。AI に渡さない */
  selfScore: number | null;
  selfNote: string;
  analysis: { step1: Step1Result; step2: Step2Result; mock: boolean } | null;
  /** 画面 3：問いへの本人の答え */
  answers: { question: string; answer: string }[];
  /** 画面 4：候補と、選んだ一つ */
  candidates: { step3: Step3Result; mock: boolean } | null;
  spark: SparkChoice | null;
  sparkSkipped: boolean;
  /** 画面 5 */
  followUp: FollowUpData | null;
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
    transcript: null,
    mock: false,
    step0Ms: null,
    selfScore: null,
    selfNote: "",
    analysis: null,
    answers: [],
    candidates: null,
    spark: null,
    sparkSkipped: false,
    followUp: null,
  };
}

export function newFollowUp(raw = ""): FollowUpData {
  return { raw, transcript: null, mock: false, step0Ms: null, selfVerdict: null, selfScore: null, result: null, countedSparkId: null };
}

/** 古い保存に無い項目を埋める */
function fill(s: Partial<SessionData>): SessionData {
  return { ...newSession(), ...s, answers: s.answers ?? [], sparkSkipped: s.sparkSkipped ?? false, firstMeeting: s.firstMeeting ?? true } as SessionData;
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

/** 画面 3 の問い（場面ごとの問いと、事情を尋ねる問い） */
export function questionsOf(s: SessionData): string[] {
  const a = s.analysis;
  if (!a) return [];
  const qs = a.step1.scenes.map((sc) => sc.question).filter((q) => q.trim() !== "");
  if (a.step1.extraQuestion) qs.push(a.step1.extraQuestion);
  return qs;
}
