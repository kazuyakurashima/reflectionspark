// 画面 4：行動の候補（工程 3）。次に試せる所の場面と、本人の答えから作る。本人の自己採点は受け取らない（決まり 10）。
import { NextResponse } from "next/server";

import { candidatesOrMock } from "@/engine/server.mts";
import type { Scene, Transcript } from "@/engine/types.mts";

export async function POST(req: Request) {
  let body: { transcript?: Transcript; scene?: Scene; answer?: unknown; selfScore?: unknown; selfNote?: unknown; demo?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON が読めません" }, { status: 400 });
  }
  if (body.selfScore !== undefined || body.selfNote !== undefined) {
    return NextResponse.json({ error: "自己採点と一言は、この呼び出しに入れません（決まり 10）" }, { status: 400 });
  }
  const t = body.transcript;
  const scene = body.scene;
  if (!t || !Array.isArray(t.utterances) || t.utterances.length === 0 || !t.kind) {
    return NextResponse.json({ error: "発話の並びがありません" }, { status: 400 });
  }
  if (!scene || scene.type !== "次に試せる所") {
    return NextResponse.json({ error: "次に試せる所の場面がありません" }, { status: 400 });
  }
  const answer = typeof body.answer === "string" ? body.answer : "";
  try {
    // demo：Demo Mode のサンプルを通したとき。サンプルの講師の記録を添えるのは、このときだけ
    return NextResponse.json(await candidatesOrMock(t, scene, answer, { demo: body.demo === true }));
  } catch (e) {
    return NextResponse.json({ error: `候補を作れませんでした：${(e as Error).message}` }, { status: 502 });
  }
}
