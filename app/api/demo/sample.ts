// Demo Mode のサンプル：山場の 1 組（student-shinro とその続き student-shinro-2）のボイスメモの文字起こし（話者の無い文）。
// 作ったダミーで、実在の人物ではない。ビルド時に読んで静的に返す。
import fs from "node:fs";
import path from "node:path";

export function demoSample(part: 1 | 2) {
  const name = part === 2 ? "student-shinro-2" : "student-shinro";
  const file = path.join(process.cwd(), "eval", "cases", name, "voicememo.txt");
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "").trim();
  return { name, part, kind: "生徒" as const, otherName: "Aさん", raw };
}
