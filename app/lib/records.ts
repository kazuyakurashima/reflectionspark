// 記録の一覧（GET /api/records）を読む。画面 1・5 の入口と、記録の画面で使う。AI は呼ばない。
// 同じ画面の行き来で何度も読まないよう、読めた結果はこのタブの中で使い回す（開き直すと読み直す）。読めなかった結果は使い回さない。

import { useEffect, useState } from "react";

import type { RecordsResponse } from "@/engine/server.mts";

/** 読めなかった（通信の失敗など）は "error"。読んでいる間は undefined */
export type RecordsState = RecordsResponse | "error" | undefined;

let cache: Promise<RecordsResponse | "error"> | null = null;

function load(): Promise<RecordsResponse | "error"> {
  cache ??= fetch("/api/records")
    .then(async (r) => {
      const value = r.ok ? ((await r.json()) as RecordsResponse) : ("error" as const);
      if (value === "error" || (value.enabled && !value.ok)) cache = null;
      return value;
    })
    .catch(() => {
      cache = null;
      return "error" as const;
    });
  return cache;
}

/** retry を変えると読み直す */
export function useRecords(retry = 0): RecordsState {
  const [state, setState] = useState<{ retry: number; value: RecordsResponse | "error" } | null>(null);
  useEffect(() => {
    let alive = true;
    if (retry > 0) cache = null;
    void load().then((value) => {
      if (alive) setState({ retry, value });
    });
    return () => {
      alive = false;
    };
  }, [retry]);
  return state && state.retry === retry ? state.value : undefined;
}
