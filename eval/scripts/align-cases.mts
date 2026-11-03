// ボイスメモの文字起こしと台本の行の対応を、12 本すべてで作って保存する。
// 使い方：node eval/scripts/align-cases.mts
// 出力：eval/results/align/<case>.json（行ごとの対応）と eval/results/align/README.md（表）
// 評価の軸 11・12 と「文字起こしに無い行」で使う。API は呼ばない。

import fs from "node:fs";
import path from "node:path";

import { alignScriptToMemo, parseScript } from "../lib/align.mts";

const casesDir = path.resolve("eval/cases");
const outDir = path.resolve("eval/results/align");
fs.mkdirSync(outDir, { recursive: true });

const rows: string[] = [];
for (const c of fs.readdirSync(casesDir).sort()) {
  const dir = path.join(casesDir, c);
  const scriptFile = path.join(dir, "script.txt");
  const memoFile = path.join(dir, "voicememo.txt");
  if (!fs.existsSync(scriptFile) || !fs.existsSync(memoFile)) continue;
  const script = parseScript(fs.readFileSync(scriptFile, "utf8"));
  const memo = fs.readFileSync(memoFile, "utf8");
  const a = alignScriptToMemo(script, memo);
  const out = {
    case: c,
    threshold: a.threshold,
    scriptLines: script.length,
    missingLines: a.missingLines,
    lines: a.lines.map((l) => ({
      line: l.line,
      speaker: l.speaker,
      chars: l.chars,
      matched: l.matched,
      matchRatio: Number(l.matchRatio.toFixed(2)),
      missing: l.missing,
      memoSpan: l.memoSpan,
      memoText: l.memoSpan ? [...memo].slice(l.memoSpan[0], l.memoSpan[1]).join("") : null,
      text: l.text,
    })),
  };
  fs.writeFileSync(path.join(outDir, `${c}.json`), JSON.stringify(out, null, 2) + "\n");
  const present = a.lines.filter((l) => !l.missing);
  const meanRatio = present.length ? present.reduce((s, l) => s + l.matchRatio, 0) / present.length : 0;
  const missingShort = a.lines.filter((l) => l.missing && l.chars <= 3).length;
  rows.push(
    `| ${c} | ${script.length} | ${a.missingLines.length} | ${missingShort} | ${meanRatio.toFixed(2)} | ${a.missingLines.join("、") || "—"} |`,
  );
}

const md = `# ボイスメモの文字起こしと台本の行の対応

- 作り方：\`node eval/scripts/align-cases.mts\`（API は呼ばない）。文字単位の大域整列で、台本の各行をボイスメモの文に対応させる（\`eval/lib/align.mts\`）。
- 「文字起こしに無い行」：行の文字のうち、ボイスメモの同じ文字と対応したものが 4 割未満の行。短い相づち（「はい。」など）が落ちた行も含む。
- 一致の割合：無い行を除いた、行ごとの一致した文字の割合の平均。聞き違いの多さの目安。
- 正解の範囲からこれらの行を除く扱いは \`docs/設計書.md\`「読み方と決まり」の「文字起こしに無い行」のとおり。

| ケース | 台本の行数 | 文字起こしに無い行 | うち 3 字以下 | 一致の割合 | 無い行 |
|---|---|---|---|---|---|
${rows.join("\n")}
`;
fs.writeFileSync(path.join(outDir, "README.md"), md);
console.log(md);
