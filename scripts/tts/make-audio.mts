// ダミー面談の台本を音声（MP3。Mac では M4A も）にする。
// 使い方は docs/音声の作り方.md。
//
//   npm run tts -- <台本ファイル> [--dry-run] [--out 出力.mp3] [--config 設定.json] [--model モデル ID] [--no-m4a]

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

import { checkSpeakersKnown, describeSpeaker, parseConfig, speakersMissingVoiceId } from "./config.mts";
import type { TtsConfig } from "./config.mts";
import { parseDialogue, splitIntoChunks } from "./dialogue.mts";
import type { Chunk, Utterance } from "./dialogue.mts";
import { synthesize } from "./elevenlabs.mts";
import type { SynthesizeResult } from "./elevenlabs.mts";
import { concatMp3 } from "./mp3.mts";

const DEFAULT_CONFIG = fileURLToPath(new URL("./voices.json", import.meta.url));

const HELP = `ダミー面談の台本を ElevenLabs Text to Dialogue API で音声にします。

使い方：
  npm run tts -- <台本ファイル> [オプション]

オプション：
  --dry-run          API を呼ばずに、台本の読み取りと分け方だけを見せる（API キーは要らない）
  -o, --out <path>   出力する MP3（既定：台本と同じ場所・同じ名前の .mp3）
  -c, --config <path> 声の設定（既定：scripts/tts/voices.json）
  -m, --model <id>   このモデルだけを使う（設定の models の順に試すのをやめる）
  --no-m4a           Mac でも M4A に変換しない
  -h, --help         この説明を出す

API キーは環境変数 ELEVENLABS_API_KEY から読みます。`;

/** npm run から呼ばれても、打った場所を基準にパスを読む */
const userCwd = process.env.INIT_CWD ?? process.cwd();

function readArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: "string", short: "o" },
        config: { type: "string", short: "c" },
        model: { type: "string", short: "m" },
        "dry-run": { type: "boolean" },
        "no-m4a": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    throw new Error(`オプションが読めません（${(err as Error).message}）。\n\n${HELP}`);
  }
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = readArgs(argv);

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (positionals.length !== 1) {
    throw new Error(`台本ファイルを 1 つ指定してください。\n\n${HELP}`);
  }

  const scriptPath = path.resolve(userCwd, positionals[0]);
  const configPath = values.config ? path.resolve(userCwd, values.config) : DEFAULT_CONFIG;
  const outMp3 = path.resolve(userCwd, values.out ?? replaceExt(scriptPath, ".mp3"));
  if (path.extname(outMp3).toLowerCase() !== ".mp3") {
    throw new Error(`出力は .mp3 のファイル名にしてください（${values.out}）。`);
  }
  if (outMp3 === scriptPath) {
    throw new Error("出力のファイル名が台本と同じです。--out で別の名前にしてください。");
  }
  const outM4a = replaceExt(outMp3, ".m4a");
  const partsDir = replaceExt(outMp3, ".parts");

  const config = parseConfig(await readJson(configPath), display(configPath));
  const utterances = parseDialogue(await readText(scriptPath, "台本"));
  checkSpeakersKnown(utterances, config);
  const chunks = splitIntoChunks(utterances, config.maxCharsPerRequest);
  const models = values.model ? [values.model] : config.models;
  const missingVoices = speakersMissingVoiceId(utterances, config);
  const makeM4a = process.platform === "darwin" && !values["no-m4a"];

  printPlan({ scriptPath, utterances, chunks, config, models, missingVoices, outMp3, outM4a, makeM4a });

  if (values["dry-run"]) {
    console.log("\n--dry-run なので、API は呼びませんでした。");
    if (missingVoices.length > 0) {
      console.log(`音声を作る前に、${display(configPath)} に声の ID を入れてください。`);
    }
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "環境変数 ELEVENLABS_API_KEY が空です。キーを環境変数に入れてから回してください（docs/音声の作り方.md）。",
    );
  }
  if (missingVoices.length > 0) {
    const list = missingVoices.map((s) => describeSpeaker(s, config)).join("・");
    throw new Error(`声の ID がまだ入っていません：${list}。${display(configPath)} の voiceId に入れてください。`);
  }

  console.log("");
  let result: SynthesizeResult;
  try {
    result = await synthesize(
      { chunks, config, models, apiKey, partsDir },
      { fetch: (url, init) => fetch(url, init), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: console.log },
    );
  } catch (err) {
    if (await exists(partsDir)) {
      console.error(`途中まで作った分は ${display(partsDir)} に残してあります。もう一度回すと、残りの分だけを作ります。`);
    }
    throw err;
  }

  await mkdir(path.dirname(outMp3), { recursive: true });
  await writeFile(outMp3, concatMp3(result.parts));
  await rm(partsDir, { recursive: true, force: true });

  const total = utterances.reduce((sum, u) => sum + [...u.text].length, 0);
  console.log(`\nMP3 ができました：${display(outMp3)}`);
  console.log(
    `  モデル ${result.model}、${chunks.length} 回の呼び出しで作成（前に作った分を使ったのは ${result.reused} 回）、本文 ${total.toLocaleString("ja-JP")} 字`,
  );

  if (makeM4a) {
    try {
      await promisify(execFile)("afconvert", ["-f", "m4af", "-d", "aac", outMp3, outM4a]);
    } catch (err) {
      throw new Error(`afconvert で M4A にできませんでした（MP3 はできています）：${(err as Error).message}`);
    }
    console.log(`M4A ができました：${display(outM4a)}（ボイスメモに入れて文字起こしできます）`);
  } else if (process.platform !== "darwin") {
    console.log("Mac ではないので、M4A への変換は飛ばしました。");
  }
}

function printPlan(p: {
  scriptPath: string;
  utterances: Utterance[];
  chunks: Chunk[];
  config: TtsConfig;
  models: string[];
  missingVoices: string[];
  outMp3: string;
  outM4a: string;
  makeM4a: boolean;
}): void {
  const n = (x: number) => x.toLocaleString("ja-JP");
  const total = p.chunks.reduce((sum, c) => sum + c.chars, 0);
  const counts = new Map<string, number>();
  for (const u of p.utterances) counts.set(u.speaker, (counts.get(u.speaker) ?? 0) + 1);

  console.log(`台本：${display(p.scriptPath)}`);
  console.log(
    `発話：${p.utterances.length}（${[...counts].map(([s, c]) => `${s} ${c}`).join("・")}）、本文 ${n(total)} 字`,
  );
  console.log(`モデル：${p.models.join(" → 使えなければ ")}`);
  console.log(
    `1 回に送る上限：${n(p.config.maxCharsPerRequest)} 字 → ${p.chunks.length === 1 ? "1 回で送ります" : `${p.chunks.length} 回に分けて送ります`}`,
  );
  p.chunks.forEach((c, i) => {
    const first = c.utterances[0].line;
    const last = c.utterances[c.utterances.length - 1].line;
    console.log(
      `  ${i + 1} 回目：${first === last ? first : `${first}〜${last}`} 行目、発話 ${c.utterances.length}、${n(c.chars)} 字（${c.speakers.join("・")}）`,
    );
  });
  console.log("声：");
  for (const speaker of counts.keys()) {
    const id = p.config.speakers[speaker].voiceId;
    console.log(`  ${describeSpeaker(speaker, p.config)}：${id === "" ? "未設定" : id}`);
  }
  console.log(`出力：${display(p.outMp3)}${p.makeM4a ? ` と ${display(p.outM4a)}` : ""}`);
}

async function readText(file: string, what: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    throw new Error(`${what}（${display(file)}）を読めませんでした：${(err as Error).message}`);
  }
}

async function readJson(file: string): Promise<unknown> {
  const text = await readText(file, "設定ファイル");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`設定ファイル（${display(file)}）が JSON として読めません：${(err as Error).message}`);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function replaceExt(file: string, ext: string): string {
  return path.join(path.dirname(file), path.basename(file, path.extname(file)) + ext);
}

function display(p: string): string {
  const rel = path.relative(userCwd, p);
  return rel === "" || rel.startsWith("..") ? p : rel;
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`\nエラー：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
