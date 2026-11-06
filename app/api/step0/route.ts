// 画面 1：文字起こしを整形する（工程 0）。API キーが無いときは仮の出力を返す。
import { NextResponse } from "next/server";

import { step0OrMock } from "@/engine/server.mts";
import type { MeetingKind } from "@/engine/types.mts";
import { progressResponse, wantsProgress } from "@/app/lib/progress-stream.mts";

const KINDS: MeetingKind[] = ["生徒", "保護者", "コーチング"];

export async function POST(req: Request) {
  let body: { raw?: unknown; kind?: unknown };
  try {
    body = (await req.json()) as { raw?: unknown; kind?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON が読めません" }, { status: 400 });
  }
  const raw = typeof body.raw === "string" ? body.raw.trim() : "";
  const kind = KINDS.includes(body.kind as MeetingKind) ? (body.kind as MeetingKind) : null;
  if (!raw) return NextResponse.json({ error: "文字起こしが空です" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "場面の種類が読めません" }, { status: 400 });
  if ([...raw].length > 40000) return NextResponse.json({ error: "文字起こしが長すぎます（4 万字まで）" }, { status: 400 });
  // 画面は、待つ間の進み具合を 1 行ずつ受け取る（app/lib/progress-stream.mts）
  if (wantsProgress(req)) return progressResponse((onProgress) => step0OrMock(raw, kind, onProgress), "整形に失敗しました：");
  try {
    return NextResponse.json(await step0OrMock(raw, kind));
  } catch (e) {
    return NextResponse.json({ error: `整形に失敗しました：${(e as Error).message}` }, { status: 502 });
  }
}
