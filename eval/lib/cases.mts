// 評価のケースの読み取りと、結果の保存先。

import fs from "node:fs";
import path from "node:path";

import type { MeetingKind } from "../../engine/types.mts";
import { alignScriptToMemo, parseScript } from "./align.mts";
import type { Alignment, ScriptLine } from "./align.mts";
import { loadTruth } from "./truth.mts";
import type { Truth } from "./truth.mts";

export const CASES_DIR = path.resolve("eval/cases");
export const RUNS_DIR = path.resolve("eval/results/runs");

/** ケース名から場面の種類を決める */
export function kindOfCase(name: string): MeetingKind {
  if (name.startsWith("parent") || name === "trap-noevidence") return "保護者";
  if (name.startsWith("coaching")) return "コーチング";
  return "生徒";
}

export type EvalCase = {
  name: string;
  kind: MeetingKind;
  /** ボイスメモの文字起こし（話者の無い 1 本の文） */
  raw: string;
  script: ScriptLine[];
  alignment: Alignment;
  truth: Truth | null;
};

export function loadCase(name: string): EvalCase {
  const dir = path.join(CASES_DIR, name);
  const raw = fs.readFileSync(path.join(dir, "voicememo.txt"), "utf8").replace(/^﻿/, "").trim();
  const script = parseScript(fs.readFileSync(path.join(dir, "script.txt"), "utf8"));
  const alignment = alignScriptToMemo(script, raw);
  let truth: Truth | null = null;
  try {
    truth = loadTruth(name);
  } catch {
    truth = null;
  }
  return { name, kind: kindOfCase(name), raw, script, alignment, truth };
}

export function runDir(caseName: string): string {
  const d = path.join(RUNS_DIR, caseName);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function saveJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function loadJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** 時刻の印（ファイル名用） */
export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
