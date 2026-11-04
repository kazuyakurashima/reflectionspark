// Route Handler から呼ぶ入口。API キーがあれば本物のエンジン、無ければ仮の出力（engine/mock.mts）を返す。
// 返す形はどちらも同じ（engine/types.mts）なので、画面は差し替えを意識しない。

import { guardStep1, guardStep2, guardStep3, guardStep4 } from "./guard.mts";
import { mockStep0, mockStep1, mockStep2, mockStep3, mockStep4 } from "./mock.mts";
import { runStep0 } from "./step0.mts";
import { runStep1 } from "./step1.mts";
import { runStep2 } from "./step2.mts";
import { runStep3 } from "./step3.mts";
import { runStep4 } from "./step4.mts";
import type { MeetingKind, Scene, Spark, Step1Result, Step2Result, Step3Result, Step4Result, Transcript } from "./types.mts";

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type Step0Response = { transcript: Transcript; mock: boolean; ms: number };
export type AnalyzeResponse = { step1: Step1Result; step2: Step2Result; mock: boolean; ms: number };
export type CandidatesResponse = { step3: Step3Result; mock: boolean; ms: number };
export type FollowUpResponse = { step4: Step4Result; mock: boolean; ms: number };

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
    const step1 = guardStep1(mockStep1(transcript), transcript.utterances);
    return { step1, step2: guardStep2(mockStep2(transcript, firstMeeting), transcript.utterances), mock: true, ms: Date.now() - t0 };
  }
  const step1 = await runStep1(transcript);
  const step2 = await runStep2(transcript, step1.scenes);
  return { step1, step2, mock: false, ms: Date.now() - t0 };
}

/** 工程 3（画面 4）。次に試せる所の場面と本人の答えから候補を作る。本人の自己採点は受け取らない。 */
export async function candidatesOrMock(transcript: Transcript, scene: Scene, answer: string): Promise<CandidatesResponse> {
  const t0 = Date.now();
  if (!hasApiKey()) {
    return { step3: guardStep3(mockStep3(scene, answer), transcript.utterances), mock: true, ms: Date.now() - t0 };
  }
  const step3 = await runStep3(transcript, scene, answer);
  return { step3, mock: false, ms: Date.now() - t0 };
}

/** 工程 4（画面 5）。今回の文字起こしと前回の Spark から追跡する。本人の自己評価は受け取らない（決まり 10）。 */
export async function followUpOrMock(transcript: Transcript, spark: Spark): Promise<FollowUpResponse> {
  const t0 = Date.now();
  if (!hasApiKey()) {
    return { step4: guardStep4(mockStep4(transcript, spark), transcript.utterances), mock: true, ms: Date.now() - t0 };
  }
  const step4 = await runStep4(transcript, spark);
  return { step4, mock: false, ms: Date.now() - t0 };
}
