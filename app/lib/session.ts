// 画面の間で持ち回る面談のデータ（localStorage）。認証なしで Demo Mode を成り立たせる。
// 本人の自己採点と一言はここに保存するだけで、AI の呼び出しには入れない（決まり 10）。
// localStorage を外部のストアとして useSyncExternalStore で読む（保存すると購読している画面が更新される）。

import { useMemo, useSyncExternalStore } from "react";

import type { MeetingKind, Step1Result, Step2Result, Transcript } from "@/engine/types.mts";

export type SessionData = {
  id: string;
  createdAt: string;
  kind: MeetingKind;
  /** 相手の呼び名（記録を相手ごとにつなぐ札） */
  otherName: string;
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
};

const KEY = "reflectionspark:session";
const listeners = new Set<() => void>();

export function newSession(kind: MeetingKind = "生徒", otherName = "", raw = ""): SessionData {
  return {
    id: `${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    kind,
    otherName,
    raw,
    transcript: null,
    mock: false,
    step0Ms: null,
    selfScore: null,
    selfNote: "",
    analysis: null,
  };
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
    return JSON.parse(s) as SessionData;
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
      return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  }, [raw]);
}
