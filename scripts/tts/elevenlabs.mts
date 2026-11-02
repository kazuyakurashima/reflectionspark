// ElevenLabs Text to Dialogue API を呼んで、分けた台本ごとに MP3 を作る。
// API キーは呼び出し側から受け取る（ここでは環境変数を読まない）。fetch と sleep は差し替えられるので、
// テストでは API を呼ばずに、モデルの切り替え・やり直し・途中からの再開を確かめられる。

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TtsConfig } from "./config.mts";
import type { Chunk } from "./dialogue.mts";

export const API_URL = "https://api.elevenlabs.io/v1/text-to-dialogue";

/** 429 と 5xx はしばらく待ってやり直す */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
/** 1 回の生成を待つ長さ */
const TIMEOUT_MS = 5 * 60 * 1000;
/** 先頭のモデルが使えないときに、次のモデルに移る応答 */
const MODEL_UNAVAILABLE_STATUSES = new Set([400, 403, 404, 422]);

export type DialogueRequestBody = {
  inputs: { text: string; voice_id: string }[];
  model_id: string;
  language_code?: string;
  seed?: number;
  settings?: { stability: number };
};

export type Deps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
};

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(apiErrorMessage(status, body));
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** 1 回分の台本から、API に送る本文を作る。演技の指示を含め、本文には手を加えない。 */
export function buildRequestBody(chunk: Chunk, model: string, config: TtsConfig): DialogueRequestBody {
  const inputs = chunk.utterances.map((u) => {
    const voiceId = config.speakers[u.speaker]?.voiceId ?? "";
    if (voiceId === "") {
      throw new Error(`「${u.speaker}」の声の ID が設定にありません（${u.line} 行目）。`);
    }
    return { text: u.text, voice_id: voiceId };
  });
  return {
    inputs,
    model_id: model,
    ...(config.languageCode !== undefined ? { language_code: config.languageCode } : {}),
    ...(config.seed !== undefined ? { seed: config.seed } : {}),
    ...(config.stability !== undefined ? { settings: { stability: config.stability } } : {}),
  };
}

export function requestUrl(outputFormat: string): string {
  return `${API_URL}?output_format=${encodeURIComponent(outputFormat)}`;
}

/** 1 回分を API に送り、MP3 のバイト列を受け取る。429・5xx・つながらないときは待ってやり直す。 */
export async function requestDialogue(
  body: DialogueRequestBody,
  opts: { apiKey: string; outputFormat: string },
  deps: Deps,
): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    const wait = 2000 * 2 ** attempt; // 2 秒、4 秒、8 秒
    let res: Response;
    try {
      res = await deps.fetch(requestUrl(opts.outputFormat), {
        method: "POST",
        headers: {
          "xi-api-key": opts.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        deps.log(`  つながりませんでした（${errorText(err)}）。${wait / 1000} 秒待ってやり直します。`);
        await deps.sleep(wait);
        continue;
      }
      throw new Error(`ElevenLabs API につながりませんでした：${errorText(err)}`);
    }

    if (res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (contentType.includes("json") || bytes.length === 0) {
        throw new Error(`ElevenLabs API から音声が返ってきませんでした（content-type: ${contentType || "なし"}）。`);
      }
      return bytes;
    }

    const text = await res.text().catch(() => "");
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait;
      deps.log(`  API が ${res.status} を返しました。${ms / 1000} 秒待ってやり直します。`);
      await deps.sleep(ms);
      continue;
    }
    throw new ApiError(res.status, text);
  }
}

/** 先頭のモデルが使えないとみなして次のモデルに移るか */
export function isModelUnavailable(err: unknown): err is ApiError {
  return err instanceof ApiError && MODEL_UNAVAILABLE_STATUSES.has(err.status);
}

/** 途中で作った分のファイル名。送る中身が同じなら同じ名前になる。 */
export function partFileName(index: number, body: DialogueRequestBody, outputFormat: string): string {
  const hash = createHash("sha256").update(JSON.stringify({ body, outputFormat })).digest("hex").slice(0, 12);
  return `${String(index + 1).padStart(2, "0")}-${hash}.mp3`;
}

export type SynthesizeOptions = {
  chunks: Chunk[];
  config: TtsConfig;
  /** 先に試す順のモデル */
  models: string[];
  apiKey: string;
  /** 途中で作った分を置くディレクトリ。同じ中身の分があれば、送らずにそれを使う。 */
  partsDir: string;
};

export type SynthesizeResult = {
  model: string;
  parts: Uint8Array[];
  /** 前に作った分を使った数 */
  reused: number;
};

/**
 * 分けた台本を順に音声にする。1 回目で先頭のモデルが使えなければ次のモデルで最初から作る。
 * 1 本の中でモデルを混ぜない。
 */
export async function synthesize(opts: SynthesizeOptions, deps: Deps): Promise<SynthesizeResult> {
  const { chunks, config, models, apiKey, partsDir } = opts;
  if (chunks.length === 0) throw new Error("送る台本がありません。");
  if (models.length === 0) throw new Error("使うモデルがありません。");

  const failures: string[] = [];
  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    const parts: Uint8Array[] = [];
    let reused = 0;

    for (let i = 0; i < chunks.length; i++) {
      const body = buildRequestBody(chunks[i], model, config);
      const file = path.join(partsDir, partFileName(i, body, config.outputFormat));
      const label = `${i + 1}/${chunks.length} 回目（${model}、${chunks[i].chars.toLocaleString("ja-JP")} 字）`;

      const cached = await readIfExists(file);
      if (cached !== null) {
        deps.log(`${label}：前に作った分を使います。`);
        parts.push(cached);
        reused++;
        continue;
      }

      deps.log(`${label}：作っています…`);
      let bytes: Uint8Array;
      try {
        bytes = await requestDialogue(body, { apiKey, outputFormat: config.outputFormat }, deps);
      } catch (err) {
        const firstOfModel = i === 0;
        if (firstOfModel && m < models.length - 1 && isModelUnavailable(err)) {
          failures.push(`${model}：${err.message}`);
          deps.log(`${model} は使えませんでした（${err.status}）。${models[m + 1]} で作ります。`);
          break;
        }
        if (firstOfModel && failures.length > 0 && err instanceof Error) {
          const all = [...failures, `${model}：${err.message}`].join("\n");
          throw new Error(`どのモデルでも作れませんでした。\n${all}`);
        }
        throw err;
      }
      await mkdir(partsDir, { recursive: true });
      await writeFile(file, bytes);
      parts.push(bytes);
    }

    if (parts.length === chunks.length) return { model, parts, reused };
  }
  // ここには来ない（最後のモデルの失敗は上で投げる）
  throw new Error(failures.join("\n"));
}

async function readIfExists(file: string): Promise<Uint8Array | null> {
  try {
    const buf = await readFile(file);
    return buf.length > 0 ? new Uint8Array(buf) : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function apiErrorMessage(status: number, body: string): string {
  const detail = body.trim().slice(0, 500);
  const hint =
    status === 401
      ? "API キー（ELEVENLABS_API_KEY）を確かめてください。"
      : status === 429
        ? "混んでいるか、使える量の上限です。しばらく待ってからもう一度回してください。"
        : "";
  return `ElevenLabs API が ${status} を返しました。${hint}${detail ? `\n${detail}` : ""}`;
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message}: ${cause.message}` : err.message;
  }
  return String(err);
}
