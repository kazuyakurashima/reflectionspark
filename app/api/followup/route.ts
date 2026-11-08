// 画面 4：次の面談で（工程 4）。今回の文字起こしと前回の Spark から、前回の行動がどう現れたかを判定する。
// 本人の自己評価（四つの言葉と点）と前回の AI の点・判定は受け取らない（決まり 10）。入っていれば 400。
import { NextResponse } from "next/server";

import { followUpOrMock } from "@/engine/server.mts";
import type { Spark, Transcript } from "@/engine/types.mts";

const FORBIDDEN_KEYS = ["selfVerdict", "selfScore", "selfNote", "selfEvaluation", "previousScores", "previousVerdict"];

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON が読めません" }, { status: 400 });
  }
  const leaked = FORBIDDEN_KEYS.filter((k) => body[k] !== undefined);
  if (leaked.length) {
    return NextResponse.json({ error: `本人の自己評価と前回の点は、この呼び出しに入れません（決まり 10）：${leaked.join("、")}` }, { status: 400 });
  }
  const t = body.transcript as Transcript | undefined;
  const spark = body.spark as Spark | undefined;
  if (!t || !Array.isArray(t.utterances) || t.utterances.length === 0 || !t.kind) {
    return NextResponse.json({ error: "今回の発話の並びがありません" }, { status: 400 });
  }
  if (!spark || typeof spark.sentence !== "string" || spark.sentence.trim() === "") {
    return NextResponse.json({ error: "前回の「次に試すひとつ」がありません" }, { status: 400 });
  }
  const clean: Spark = {
    sentence: spark.sentence,
    criterion: typeof spark.criterion === "string" ? spark.criterion : null,
    previousScene: spark.previousScene
      ? { context: String(spark.previousScene.context ?? ""), quoteText: spark.previousScene.quoteText ?? null, reading: String(spark.previousScene.reading ?? "") }
      : null,
  };
  try {
    return NextResponse.json(await followUpOrMock(t, clean));
  } catch (e) {
    return NextResponse.json({ error: `追跡に失敗しました：${(e as Error).message}` }, { status: 502 });
  }
}
