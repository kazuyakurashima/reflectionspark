// 画面 2：場面・読み・問い（工程 1）と点（工程 2）。本人の自己採点と一言は受け取らない（決まり 10）。
import { NextResponse } from "next/server";

import { analyzeOrMock } from "@/engine/server.mts";
import type { Transcript } from "@/engine/types.mts";
import { progressResponse, wantsProgress } from "@/app/lib/progress-stream.mts";

export async function POST(req: Request) {
  let body: { transcript?: Transcript; firstMeeting?: boolean; selfScore?: unknown; selfNote?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON が読めません" }, { status: 400 });
  }
  if (body.selfScore !== undefined || body.selfNote !== undefined) {
    // 先に入った評価は AI に渡さない。受け取らないことで守る
    return NextResponse.json({ error: "自己採点と一言は、この呼び出しに入れません（決まり 10）" }, { status: 400 });
  }
  const t = body.transcript;
  if (!t || !Array.isArray(t.utterances) || t.utterances.length === 0 || !t.kind) {
    return NextResponse.json({ error: "発話の並びがありません。先に画面 1 で話者を分けてください" }, { status: 400 });
  }
  // 画面は、待つ間の進み具合を 1 行ずつ受け取る（app/lib/progress-stream.mts）
  if (wantsProgress(req)) return progressResponse((onProgress) => analyzeOrMock(t, body.firstMeeting ?? true, onProgress), "分析に失敗しました：");
  try {
    return NextResponse.json(await analyzeOrMock(t, body.firstMeeting ?? true));
  } catch (e) {
    return NextResponse.json({ error: `分析に失敗しました：${(e as Error).message}` }, { status: 502 });
  }
}
