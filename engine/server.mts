// Route Handler から呼ぶ入口。API キーがあれば本物のエンジン、無ければ仮の出力（engine/mock.mts）を返す。
// 返す形はどちらも同じ（engine/types.mts）なので、画面は差し替えを意識しない。

import { mockStep0, mockStep1, mockStep2 } from "./mock.mts";
import { runStep0 } from "./step0.mts";
import { runStep1 } from "./step1.mts";
import { runStep2 } from "./step2.mts";
import type { MeetingKind, Step1Result, Step2Result, Transcript } from "./types.mts";

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type Step0Response = { transcript: Transcript; mock: boolean; ms: number };
export type AnalyzeResponse = { step1: Step1Result; step2: Step2Result; mock: boolean; ms: number };

/** 工程 0（画面 1）。0c も回す。 */
export async function step0OrMock(raw: string, kind: MeetingKind): Promise<Step0Response> {
  const t0 = Date.now();
  if (!hasApiKey()) {
    return { transcript: mockStep0(raw, kind), mock: true, ms: Date.now() - t0 };
  }
  const r = await runStep0(raw, kind, { with0c: true });
  return { transcript: r.transcript, mock: false, ms: Date.now() - t0 };
}

/** 工程 1 → 2（画面 2）。本人の自己採点と一言は受け取らない（決まり 10）。 */
export async function analyzeOrMock(transcript: Transcript, firstMeeting = true): Promise<AnalyzeResponse> {
  const t0 = Date.now();
  if (!hasApiKey()) {
    const step1 = mockStep1(transcript);
    return { step1, step2: mockStep2(transcript, firstMeeting), mock: true, ms: Date.now() - t0 };
  }
  const step1 = await runStep1(transcript);
  const step2 = await runStep2(transcript, step1.scenes);
  return { step1, step2, mock: false, ms: Date.now() - t0 };
}
