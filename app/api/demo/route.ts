// Demo Mode のサンプル：山場の 1 回目（student-shinro）のボイスメモの文字起こし（話者の無い文）。
// 作ったダミーで、実在の人物ではない。
import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export async function GET() {
  const file = path.join(process.cwd(), "eval", "cases", "student-shinro", "voicememo.txt");
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "").trim();
  return NextResponse.json({ name: "student-shinro", kind: "生徒", otherName: "Aさん", raw });
}
