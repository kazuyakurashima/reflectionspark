// 声の設定（voices.json）の読み取りと確かめ。
// 話者名と声の ID の対応、使うモデル、1 回に送る文字数をここで変える。

import type { Utterance } from "./dialogue.mts";

export type SpeakerVoice = {
  /** 覚え書き用の声の名前（API には送らない） */
  voiceName?: string;
  voiceId: string;
};

export type TtsConfig = {
  /** 使うモデルを先に試す順に。先頭が使えなければ次を使う。 */
  models: string[];
  /** ElevenLabs の output_format。MP3 をつなぐので mp3_ で始まるものだけ。 */
  outputFormat: string;
  /** 1 回に送る本文の文字数の上限 */
  maxCharsPerRequest: number;
  /** 指定したときだけ送る（ISO 639-1。例 "ja"）。モデルが対応していないと API がエラーを返す。 */
  languageCode?: string;
  /** 指定したときだけ送る。同じ値なら似た読み方になりやすい。 */
  seed?: number;
  /** 指定したときだけ送る（0〜1）。低いほど表現の幅が広く、高いほど安定する。 */
  stability?: number;
  speakers: Record<string, SpeakerVoice>;
};

/** voices.json の中身を確かめて型を付ける。おかしな所はまとめて投げる。 */
export function parseConfig(json: unknown, source = "設定ファイル"): TtsConfig {
  const problems: string[] = [];
  if (!isObject(json)) {
    throw new Error(`${source} の中身が JSON のオブジェクトではありません。`);
  }

  const { models, outputFormat, maxCharsPerRequest, languageCode, seed, stability, speakers } = json;

  if (!Array.isArray(models) || models.length === 0 || !models.every((m) => typeof m === "string" && m !== "")) {
    problems.push("models は、モデル ID の文字列を 1 つ以上並べた配列にしてください（例 [\"eleven_v4\", \"eleven_v3\"]）。");
  }
  if (typeof outputFormat !== "string" || !outputFormat.startsWith("mp3_")) {
    problems.push("outputFormat は mp3_ で始まる値にしてください（例 \"mp3_44100_128\"）。");
  }
  if (typeof maxCharsPerRequest !== "number" || !Number.isInteger(maxCharsPerRequest) || maxCharsPerRequest <= 0) {
    problems.push("maxCharsPerRequest は 1 以上の整数にしてください。");
  }
  if (languageCode !== undefined && (typeof languageCode !== "string" || languageCode === "")) {
    problems.push("languageCode は、使うなら \"ja\" のような文字列にしてください。使わないなら項目ごと消してください。");
  }
  if (seed !== undefined && (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0)) {
    problems.push("seed は、使うなら 0 以上の整数にしてください。");
  }
  if (stability !== undefined && (typeof stability !== "number" || stability < 0 || stability > 1)) {
    problems.push("stability は、使うなら 0 から 1 の数にしてください。");
  }

  const parsedSpeakers: Record<string, SpeakerVoice> = {};
  if (!isObject(speakers) || Object.keys(speakers).length === 0) {
    problems.push("speakers に、話者名ごとの声を 1 つ以上書いてください。");
  } else {
    for (const [name, value] of Object.entries(speakers)) {
      if (!isObject(value) || typeof value.voiceId !== "string") {
        problems.push(`speakers の「${name}」に voiceId（文字列。まだなら ""）を書いてください。`);
        continue;
      }
      if (value.voiceName !== undefined && typeof value.voiceName !== "string") {
        problems.push(`speakers の「${name}」の voiceName は文字列にしてください。`);
        continue;
      }
      parsedSpeakers[name] = { voiceName: value.voiceName, voiceId: value.voiceId.trim() };
    }
  }

  if (problems.length > 0) {
    throw new Error(`${source} に直す所があります。\n${problems.join("\n")}`);
  }

  return {
    models: models as string[],
    outputFormat: outputFormat as string,
    maxCharsPerRequest: maxCharsPerRequest as number,
    ...(languageCode !== undefined ? { languageCode: languageCode as string } : {}),
    ...(seed !== undefined ? { seed: seed as number } : {}),
    ...(stability !== undefined ? { stability: stability as number } : {}),
    speakers: parsedSpeakers,
  };
}

/** 台本に出てくる話者が設定にあるかを確かめる。無い話者があれば投げる。 */
export function checkSpeakersKnown(utterances: Utterance[], config: TtsConfig): void {
  const unknown = new Map<string, number[]>();
  for (const u of utterances) {
    if (config.speakers[u.speaker] === undefined) {
      unknown.set(u.speaker, [...(unknown.get(u.speaker) ?? []), u.line]);
    }
  }
  if (unknown.size === 0) return;
  const list = [...unknown]
    .map(([name, lines]) => `「${name}」（${lines.slice(0, 5).join("・")}${lines.length > 5 ? "…" : ""} 行目）`)
    .join("、");
  const known = Object.keys(config.speakers).join("・");
  throw new Error(`設定に無い話者名があります：${list}。設定の speakers にある名前（${known}）にそろえるか、設定に足してください。`);
}

/** 台本に出てくる話者のうち、声の ID がまだ空のものを返す（出てくる順）。 */
export function speakersMissingVoiceId(utterances: Utterance[], config: TtsConfig): string[] {
  const missing: string[] = [];
  for (const u of utterances) {
    const voice = config.speakers[u.speaker];
    if (voice !== undefined && voice.voiceId === "" && !missing.includes(u.speaker)) {
      missing.push(u.speaker);
    }
  }
  return missing;
}

/** 「講師（Hajisan）」のように、覚え書きの声の名前を添えた話者名 */
export function describeSpeaker(name: string, config: TtsConfig): string {
  const voiceName = config.speakers[name]?.voiceName;
  return voiceName ? `${name}（${voiceName}）` : name;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
