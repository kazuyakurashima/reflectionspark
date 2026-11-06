// 画面 6：記録の一覧（engine/memory-read.mts）。サーバーがメモリを読み、面談の日付順に返す。AI は呼ばない。
// 読むだけ。公開 URL に、保存・訂正・削除・夢の実行の API を置かない。ストアの番号は返さない。
import { connection, NextResponse } from "next/server";

import { recordsOrOff } from "@/engine/server.mts";

export async function GET() {
  // ビルドの時に読んで固定しない（旗もストアの中身も、届いた時に読む）
  await connection();
  return NextResponse.json(await recordsOrOff());
}
