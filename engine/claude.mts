// Claude の呼び方。サーバー側（Route Handler と評価スクリプト）からだけ使う。API キーはブラウザに出さない。
// 確かめた事実（CLAUDE.md「Claude の呼び方」）：
// - 文字起こしは 1 発話 1 ブロックの document（source.type: "content"）で渡し、citations を付ける。
// - citations と構造化出力（output_config.format）は同じ呼び出しで使えない。工程ごとに分ける。
// - 引用は content_block_location で返り、start_block_index がそのまま発話番号。
// - streaming でも引用は届く（citations_delta）。

import Anthropic from "@anthropic-ai/sdk";

import type { CallMeta } from "./types.mts";

/** 分析のモデル（既定）。環境変数で変えられる。 */
export const ANALYSIS_MODEL = process.env.REFLECTIONSPARK_MODEL ?? "claude-opus-5-5";
/** LLM 判定（評価）のモデル。 */
export const JUDGE_MODEL = process.env.REFLECTIONSPARK_JUDGE_MODEL ?? "claude-opus-5-5";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY が環境変数にありません。値はファイルに書かず、環境変数に入れてください。");
    }
    client = new Anthropic({ maxRetries: 2 });
  }
  return client;
}

/** 使用量を 1 行にまとめる（費用そのものはファイルに書かない。トークン数だけ） */
export function metaOf(model: string, ms: number, usage: Anthropic.Usage | undefined): CallMeta {
  return {
    model,
    ms,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

export type StructuredParams = {
  system: string;
  user: Anthropic.ContentBlockParam[] | string;
  /** JSON Schema。additionalProperties: false と required を付ける */
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
  model?: string;
  /** 呼び出し先の名前（記録用） */
  label?: string;
};

export type StructuredResult<T> = { data: T; rawText: string; meta: CallMeta; stopReason: string | null };

/**
 * 形の決まった出力（構造化出力）。streaming で受け、最後の本文を JSON として読む。
 * citations は付けられない（400）。
 */
export async function callStructured<T>(p: StructuredParams): Promise<StructuredResult<T>> {
  const model = p.model ?? ANALYSIS_MODEL;
  const t0 = Date.now();
  const stream = getClient().messages.stream({
    model,
    max_tokens: p.maxTokens ?? 32000,
    system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: p.user }],
    thinking: { type: "adaptive" },
    output_config: { effort: p.effort ?? "medium", format: { type: "json_schema", schema: p.schema } },
  });
  const msg = await stream.finalMessage();
  const ms = Date.now() - t0;
  const rawText = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (msg.stop_reason === "refusal") {
    throw new Error(`${p.label ?? "呼び出し"}：モデルが応答を拒みました（${JSON.stringify(msg.stop_details)}）`);
  }
  if (msg.stop_reason === "max_tokens") {
    throw new Error(`${p.label ?? "呼び出し"}：出力が max_tokens に達しました`);
  }
  let data: T;
  try {
    data = JSON.parse(rawText) as T;
  } catch (e) {
    throw new Error(`${p.label ?? "呼び出し"}：JSON として読めません：${(e as Error).message}\n${rawText.slice(0, 500)}`);
  }
  return { data, rawText, meta: metaOf(model, ms, msg.usage), stopReason: msg.stop_reason };
}

/** 本文の一区切り。citations が付く区切りと付かない区切りが交互に来る。 */
export type TextSegment = {
  text: string;
  /** 本文全体の中での位置 [start, end)（UTF-16 単位） */
  start: number;
  end: number;
  citations: Anthropic.CitationContentBlockLocation[];
};

export type CitedParams = {
  system: string;
  /** 1 発話 1 ブロック。document ブロックはここで作る（makeDocument） */
  user: Anthropic.ContentBlockParam[];
  effort?: Effort;
  maxTokens?: number;
  model?: string;
  label?: string;
  /** 本文が届くたびに呼ぶ（画面の streaming 用） */
  onText?: (delta: string) => void;
  onCitation?: (c: Anthropic.CitationContentBlockLocation) => void;
};

export type CitedResult = {
  text: string;
  segments: TextSegment[];
  /** 最初の引用が届くまでの時間（届かなければ null） */
  firstCitationMs: number | null;
  meta: CallMeta;
  stopReason: string | null;
};

/**
 * citations 付きの呼び出し（streaming）。本文は区切りごとに citations を持つ。
 * 構造化出力は付けられないので、本文の形はプロンプトで決め、engine 側で読む。
 */
export async function callCited(p: CitedParams): Promise<CitedResult> {
  const model = p.model ?? ANALYSIS_MODEL;
  const t0 = Date.now();
  let firstCitationMs: number | null = null;
  const stream = getClient().messages.stream({
    model,
    max_tokens: p.maxTokens ?? 32000,
    system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: p.user }],
    thinking: { type: "adaptive" },
    output_config: { effort: p.effort ?? "high" },
  });
  stream.on("text", (delta) => p.onText?.(delta));
  stream.on("citation", (c) => {
    if (firstCitationMs === null) firstCitationMs = Date.now() - t0;
    if (c.type === "content_block_location") p.onCitation?.(c);
  });
  const msg = await stream.finalMessage();
  const ms = Date.now() - t0;
  if (msg.stop_reason === "refusal") {
    throw new Error(`${p.label ?? "呼び出し"}：モデルが応答を拒みました（${JSON.stringify(msg.stop_details)}）`);
  }
  const segments: TextSegment[] = [];
  let text = "";
  for (const b of msg.content) {
    if (b.type !== "text") continue;
    const start = text.length;
    text += b.text;
    segments.push({
      text: b.text,
      start,
      end: text.length,
      citations: (b.citations ?? []).filter((c): c is Anthropic.CitationContentBlockLocation => c.type === "content_block_location"),
    });
  }
  return { text, segments, firstCitationMs, meta: metaOf(model, ms, msg.usage), stopReason: msg.stop_reason };
}

/**
 * 文字起こしを 1 発話 1 ブロックの document にする。
 * ブロックの順番がそのまま発話番号（start_block_index）になる。
 * ブロックの text は engine/citations.mts の blockText で作る（「話者：本文」）。cited_text はブロックの全文で返るので、
 * 照合では話者の前置きを外してから本文と完全一致で比べる。
 */
export function makeDocument(texts: string[], title: string): Anthropic.DocumentBlockParam {
  return {
    type: "document",
    title,
    source: { type: "content", content: texts.map((t) => ({ type: "text", text: t })) },
    citations: { enabled: true },
    cache_control: { type: "ephemeral" },
  };
}
