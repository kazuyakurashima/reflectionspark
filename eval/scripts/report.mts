// 保存した出力（eval/results/runs）から軸ごとの数字を計算し、Markdown の表にする。
// 使い方：node eval/scripts/report.mts [--judge]   --judge で LLM 判定（軸 3・4・10・12 の推測の意味）も回す
// 出力：eval/results/runs/report.md と、ケースごとの axes.json
// 1 行 1 ケースの表と合計。README にそのまま貼れる形。

import fs from "node:fs";
import path from "node:path";

import type { Step0Timing } from "../../engine/step0.mts";
import type { Step1Result, Step2Result, Step4Result, Transcript } from "../../engine/types.mts";
import { axis1, axis11, axis12, axis2, axis5, axis6, axis8, axis9, step0Variance } from "../lib/axes.mts";
import type { Axis1, Axis11, Axis12, Axis2, Axis5, Axis6, Axis8, Axis9, Step0Variance } from "../lib/axes.mts";
import { loadCase, loadJson, RUNS_DIR, saveJson } from "../lib/cases.mts";
import { judgeGuessMeaning, judgeQuestion, judgeQuoteSupport } from "../lib/judge.mts";
import { listTruthCases } from "../lib/truth.mts";
import { EVAL_SCRIPT_VERSION, TRUTH_VERSION } from "../lib/version.mts";

const withJudge = process.argv.includes("--judge");
type Step0File = { transcript: Transcript; timing: Step0Timing; unanchored: number };

type CaseAxes = {
  case: string;
  axis1: Axis1 | null;
  axis2: Axis2 | null;
  axis3: { scene: string; score: number; reason: string }[] | null;
  axis5: Axis5 | null;
  axis6: Axis6 | null;
  axis8: Axis8 | null;
  axis9: Axis9 | null;
  axis10: { scene: string; score: number; reason: string }[] | null;
  axis11: Axis11 | null;
  axis12: Axis12 | null;
  guessMeaning: { fragment: string; guess: string; score: number; reason: string }[] | null;
  variance: Step0Variance | null;
  timing: { step0: Step0Timing | null; step1Ms: number | null; firstCitationMs: number | null; step2Ms: number | null; step4Ms: number | null };
};

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const yn = (b: boolean | null) => (b === null ? "—" : b ? "○" : "×");

const rows: CaseAxes[] = [];
for (const name of listTruthCases()) {
  const dir = path.join(RUNS_DIR, name);
  const c = loadCase(name);
  const s0 = loadJson<Step0File>(path.join(dir, "step0.json"));
  const s1 = loadJson<Step1Result>(path.join(dir, "step1.json"));
  const s2 = loadJson<Step2Result>(path.join(dir, "step2.json"));
  const s4 = loadJson<Step4Result>(path.join(dir, "step4.json"));
  const extra = [2, 3, 4, 5, 6].map((n) => loadJson<Step0File>(path.join(dir, `step0-run${n}.json`))).filter((x): x is Step0File => x !== null);
  const t = s0?.transcript ?? null;
  const ax: CaseAxes = {
    case: name,
    axis1: s1 && t ? axis1(s1, t) : null,
    axis2: s1 && t && c.truth ? axis2(s1, c.truth, t, c.alignment) : null,
    axis3: null,
    axis5: s1 || s2 || s4 ? axis5(s1, s2, null, s4) : null,
    axis6: s4 && t && c.truth ? axis6(s4, c.truth, t, c.alignment) : null,
    axis8: s2 && c.truth ? axis8(s1, s2, c.truth) : null,
    axis9: s2 && c.truth ? axis9(s2.items, c.truth) : null,
    axis10: null,
    axis11: t ? axis11(t, c.alignment, c.script) : null,
    axis12: t ? axis12(t, c.alignment) : null,
    guessMeaning: null,
    variance: t && extra.length ? step0Variance([t, ...extra.map((x) => x.transcript)]) : null,
    timing: { step0: s0?.timing ?? null, step1Ms: s1?.meta.ms ?? null, firstCitationMs: s1?.firstCitationMs ?? null, step2Ms: s2?.meta.ms ?? null, step4Ms: s4?.meta.ms ?? null },
  };
  if (withJudge && s1 && t) {
    ax.axis3 = [];
    ax.axis10 = [];
    for (const sc of s1.scenes) {
      const q = await judgeQuestion(sc, t);
      ax.axis3.push({ scene: sc.type, score: q.score, reason: q.reason });
      if (sc.quotes.length) {
        const s = await judgeQuoteSupport(sc, t);
        ax.axis10.push({ scene: sc.type, score: s.score, reason: s.reason });
      }
    }
  }
  if (withJudge && ax.axis12) {
    ax.guessMeaning = [];
    for (const g of ax.axis12.guesses) {
      if (g.kind !== "崩れ" || !g.scriptWindow) continue;
      const j = await judgeGuessMeaning(g.fragment, g.guess, g.scriptWindow);
      ax.guessMeaning.push({ fragment: g.fragment, guess: g.guess, score: j.score, reason: j.reason });
    }
  }
  saveJson(path.join(dir, "axes.json"), ax);
  rows.push(ax);
}

const has = rows.some((r) => r.axis1 || r.axis11);
const lines: string[] = [];
lines.push(`# 評価の結果（正解 ${TRUTH_VERSION}・評価スクリプト ${EVAL_SCRIPT_VERSION}）`, "");
if (!has) {
  lines.push("保存された出力がありません（eval/results/runs が空）。`node eval/scripts/run-cases.mts` で回してから作ります。", "");
}

lines.push("## 軸 1：引用の原文一致", "", "| ケース | 生成 | 捨てた | 表示 | 表示の一致率 | 引用を出せなかった場面 | 文脈の一行に評価の言葉 |", "|---|---|---|---|---|---|---|");
for (const r of rows) {
  const a = r.axis1;
  lines.push(a ? `| ${r.case} | ${a.generated} | ${a.discarded} | ${a.displayed} | ${pct(a.displayedMatchRate)} | ${a.scenesWithoutQuote} | ${a.contextWithJudgement.length} |` : `| ${r.case} | — | — | — | — | — | — |`);
}
const a1 = rows.map((r) => r.axis1).filter((x): x is Axis1 => x !== null);
if (a1.length) {
  const gen = a1.reduce((s, a) => s + a.generated, 0);
  const dis = a1.reduce((s, a) => s + a.discarded, 0);
  const disp = a1.reduce((s, a) => s + a.displayed, 0);
  const ver = a1.reduce((s, a) => s + a.displayedVerified, 0);
  lines.push(`| **合計** | ${gen} | ${dis} | ${disp} | ${pct(disp ? ver / disp : null)} | ${a1.reduce((s, a) => s + a.scenesWithoutQuote, 0)} | ${a1.reduce((s, a) => s + a.contextWithJudgement.length, 0)} |`);
}
lines.push("");

lines.push("## 軸 2：鍵の場面の再現（作り手が確かめた所だけ。〔案〕は別の列）", "", "| ケース | 強み・いちばん | 強み・次点 | 課題・いちばん | 課題・次点 | 山場（記録だけ） | 〔案〕の場面 |", "|---|---|---|---|---|---|---|");
for (const r of rows) {
  const a = r.axis2;
  if (!a) {
    lines.push(`| ${r.case} | — | — | — | — | — | — |`);
    continue;
  }
  const cell = (n: string) => {
    const s = a.scenes.find((x) => x.truthName === n);
    if (!s) return "—";
    if (!s.verified) return "〔案〕";
    if (s.absent) return "入力に無い";
    return yn(s.matched);
  };
  const drafts = a.scenes.filter((s) => !s.verified).map((s) => `${s.truthName}：${s.absent ? "入力に無い" : yn(s.matched)}`).join("、") || "—";
  lines.push(`| ${r.case} | ${cell("強み・いちばん")} | ${cell("強み・次点")} | ${cell("課題・いちばん")} | ${cell("課題・次点")} | ${a.climax ? yn(a.climax.matched) : "—"} | ${drafts} |`);
}
lines.push("", "項目ごと（AI がその項目を関わる項目として付けた場面が、正解の範囲と重なるか。○× の項目は両方）：", "", "| ケース | 1 | 2 | 3 | 4 | 5 |", "|---|---|---|---|---|---|");
for (const r of rows) {
  const a = r.axis2;
  if (!a) {
    lines.push(`| ${r.case} | — | — | — | — | — |`);
    continue;
  }
  const cell = (it: Axis2["items"][number]) => {
    const parts: string[] = [];
    for (const [label, m] of [["よく", it.good], ["まずく", it.bad]] as const) {
      if (!m) continue;
      parts.push(`${label}${!m.verified ? "〔案〕" : ""}${m.absent ? "入力に無い" : yn(m.matched)}`);
    }
    return parts.join(" ") || (it.mark === "判定しない" ? "判定しない" : "範囲なし");
  };
  lines.push(`| ${r.case} | ${a.items.map(cell).join(" | ")} |`);
}
lines.push("");

lines.push("## 軸 3・10：問いの質、引用が読みを支えるか（LLM 判定、1〜5）", "", "| ケース | 軸 3 よく表れた所 | 軸 3 次に試せる所 | 軸 10 よく表れた所 | 軸 10 次に試せる所 |", "|---|---|---|---|---|");
for (const r of rows) {
  const g = (xs: { scene: string; score: number }[] | null, scene: string) => xs?.find((x) => x.scene === scene)?.score ?? "—";
  lines.push(`| ${r.case} | ${g(r.axis3, "よく表れた所")} | ${g(r.axis3, "次に試せる所")} | ${g(r.axis10, "よく表れた所")} | ${g(r.axis10, "次に試せる所")} |`);
}
lines.push("", "軸 4（行動の具体性）は、本人の答えが要るので通し（eval/scripts/e2e.mts）の 1 回だけ。", "");

lines.push("## 軸 5：性質の言葉の不在と点の置き場所", "", "| ケース | 性質の言葉（表示を控えた） | すり抜け | 「」を外した | 工程 1 に点が混ざった | 点が項目ごと |", "|---|---|---|---|---|---|");
for (const r of rows) {
  const a = r.axis5;
  lines.push(
    a
      ? `| ${r.case} | ${a.withheld.length}${a.withheld.length ? `（${a.withheld.map((w) => `${w.step}.${w.field}：${w.words.join("・")}`).join("、")}）` : ""} | ${a.hits.length}${a.hits.length ? `（${a.hits.map((h) => `${h.field}：${h.word}`).join("、")}）` : ""} | ${a.unverifiedQuotes} | ${a.scoresInStep1 ? "あり" : "なし"} | ${yn(a.scoresPerItem)} |`
      : `| ${r.case} | — | — | — | — | — |`,
  );
}
lines.push("");

lines.push("## 軸 6：次回の追跡", "", "| ケース | 正解 | AI | 一致 | 根拠の行が重なる |", "|---|---|---|---|---|");
for (const r of rows) {
  const a = r.axis6;
  if (a) lines.push(`| ${r.case} | ${a.truthVerdict} | ${a.aiVerdict} | ${yn(a.matched)} | ${yn(a.evidenceOverlaps)} |`);
}
lines.push("");

lines.push("## 軸 8・9：保留の正しさ、点の向き", "", "| ケース | 初回で項目 5 を保留 | 正解の「判定しない」と一致 | 点の向き（満たした／数えた組） | AI の点（1〜5、— は判定しない） |", "|---|---|---|---|---|");
for (const r of rows) {
  const a8 = r.axis8;
  const a9 = r.axis9;
  const scores = loadJson<Step2Result>(path.join(RUNS_DIR, r.case, "step2.json"))?.items.map((i) => i.score ?? "—").join(" ") ?? "—";
  const agree = a8 ? a8.withheldAsTruth.filter((w) => w.truth).map((w) => `${w.item}:${yn(w.ai)}`).join(" ") || "（無い）" : "—";
  lines.push(`| ${r.case} | ${a8 ? yn(a8.item5Withheld) : "—"} | ${agree} | ${a9 ? `${a9.satisfied}／${a9.countable}` : "—"} | ${scores} |`);
}
lines.push("");

lines.push("## 軸 11：工程 0a の話者", "", "| ケース | 発話 | 台本に対応 | 正しい | 正しさ | 高（誤り） | 中（誤り） | 低（誤り） | 2 話者にまたがる | 相手 2 人以上 |", "|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const a = r.axis11;
  if (!a) {
    lines.push(`| ${r.case} | — | — | — | — | — | — | — | — | — |`);
    continue;
  }
  const bc = (k: string) => {
    const b = a.byConfidence.find((x) => x.confidence === k)!;
    return `${b.count}（${b.wrong}）`;
  };
  lines.push(`| ${r.case} | ${a.utterances} | ${a.aligned} | ${a.correct} | ${pct(a.accuracy)} | ${bc("高")} | ${bc("中")} | ${bc("低")} | ${a.spanningSpeakers} | ${a.multipleOthers ? "あり" : "なし"} |`);
}
lines.push("");

lines.push("## 軸 12：工程 0b・0c の直しと推測", "", "| ケース | 当てた | 捨てた | 拾えた | 直しすぎ：元が正しかった | 直しすぎ：言った言葉と違う | 対応なし | 聞き違いの箇所 | うち触れた | 推測 | 本当に崩れていた | 推測が台本と合う | 正しい発話に推測 |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const a = r.axis12;
  if (!a) {
    lines.push(`| ${r.case} | — | — | — | — | — | — | — | — | — | — | — | — |`);
    continue;
  }
  lines.push(`| ${r.case} | ${a.applied} | ${a.discarded} | ${a.picked} | ${a.overfixedOriginalCorrect} | ${a.overfixedWrongWord} | ${a.unaligned} | ${a.mismatchSpots} | ${a.mismatchTouched} | ${a.guessStats.total} | ${a.guessStats.reallyBroken} | ${a.guessStats.guessMatchesScript} | ${a.guessStats.changedCorrect} |`);
}
lines.push("", "拾えた直しの種類：", "");
for (const r of rows) {
  if (r.axis12) lines.push(`- ${r.case}：${Object.entries(r.axis12.pickedByKind).map(([k, v]) => `${k} ${v}`).join("、") || "（なし）"}`);
}
lines.push("");

lines.push("## 整形の揺れ（同じ入力で工程 0 を数回）", "", "| ケース | 回数 | 発話数 | 話者の食い違い | 直しの数 | 全回で同じ直し | 推測の数 | 全回で同じ推測 | 確からしさ（高／中／低） |", "|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const v = r.variance;
  if (v) lines.push(`| ${r.case} | ${v.runs} | ${v.utteranceCounts.join("／")} | ${v.speakerDisagreements ?? "区切りが違う"} | ${v.correctionCounts.join("／")} | ${v.correctionsCommonToAll} | ${v.guessCounts.join("／")} | ${v.guessesCommonToAll} | ${v.confidenceCounts.map((c) => `${c.高}/${c.中}/${c.低}`).join("、")} |`);
}
lines.push("");

lines.push("## 時間（ms）", "", "| ケース | 0a | 0b | 0c | 工程 1 | 最初の引用まで | 工程 2 | 工程 4 |", "|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const t = r.timing;
  lines.push(`| ${r.case} | ${t.step0?.step0a.ms ?? "—"} | ${t.step0?.step0b?.ms ?? "—"} | ${t.step0?.step0c?.ms ?? "—"} | ${t.step1Ms ?? "—"} | ${t.firstCitationMs ?? "—"} | ${t.step2Ms ?? "—"} | ${t.step4Ms ?? "—"} |`);
}
lines.push("");

const out = path.join(RUNS_DIR, "report.md");
fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
