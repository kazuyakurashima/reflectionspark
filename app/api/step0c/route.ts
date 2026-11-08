// 画面 1・4：意味が通らない箇所（工程 0c）。整形とは別に回し、分析を待たせない。推測は分析に渡さない。
import { NextResponse } from "next/server";

import { step0cOrMock } from "@/engine/server.mts";
import type { Transcript } from "@/engine/types.mts";

export async function POST(req: Request) {
  let body: { transcript?: Transcript };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON が読めません" }, { status: 400 });
  }
  const t = body.transcript;
  if (!t || !Array.isArray(t.utterances) || t.utterances.length === 0 || !t.kind) {
    return NextResponse.json({ error: "発話の並びがありません" }, { status: 400 });
  }
  try {
    return NextResponse.json(await step0cOrMock(t));
  } catch (e) {
    // 補助の工程の失敗で結果が出なくなるのを防ぐ：推測なしで返す
    return NextResponse.json({ step0c: { summary: "", guesses: [], failed: (e as Error).message }, utteranceCount: t.utterances.length, mock: false, ms: 0 });
  }
}
