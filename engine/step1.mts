// 工程 1：場面・読み・問い（画面 2）。Messages API、citations、streaming。
// 受け取る：1 発話 1 ブロックの document、場面の種類、採点表 5 項目の考え方。
// 渡さない：本人の自己採点と一言、覚えている記録、工程 0c の推測（決まり 10）。
// 返す：場面 2 つ（引用は照合済みのものだけ。問いは次に試せる所だけ。読み・観察・反応が指す発話の番号は文と分けて）、サマリー、流れ。選んだ理由と次点は記録だけ。

import type Anthropic from "@anthropic-ai/sdk";

import { callCited, makeDocument } from "./claude.mts";
import type { TextSegment } from "./claude.mts";
import { blockTexts, dedupeQuotes, verifyCitation } from "./citations.mts";
import { guardStep1 } from "./guard.mts";
import { step1System, step1UserText } from "./prompts.mts";
import { findTags, parseNumbers, tagText } from "./tagged.mts";
import type { Quote, Scene, SceneType, Step1Result, Transcript, Utterance } from "./types.mts";
import { checkUtteranceRefs, parseUtteranceList, toUtteranceIndices } from "./utterance-no.mts";

export type Step1Options = {
  onText?: (delta: string) => void;
  onCitation?: (c: Anthropic.CitationContentBlockLocation) => void;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

/** 本文（タグの形）と citations の区切りから、工程 1 の結果を組み立てる。API を呼ばないので、テストで守れる。 */
export function parseStep1(text: string, segments: TextSegment[], utterances: Utterance[]): Omit<Step1Result, "meta" | "firstCitationMs" | "withheld" | "unverifiedQuotes"> {
  // すべての citation を照合する（生成した数・捨てた数のため）
  const all: { quote: Quote; start: number; end: number }[] = [];
  for (const seg of segments) {
    for (const c of seg.citations) {
      all.push({ quote: verifyCitation(c, utterances), start: seg.start, end: seg.end });
    }
  }
  const scenes: Scene[] = [];
  for (const tag of findTags(text, "scene")) {
    const type = (tag.attrs.type === "次に試せる所" ? "次に試せる所" : "よく表れた所") as SceneType;
    const inScene = all.filter((x) => x.start < tag.end && x.end > tag.start).map((x) => x.quote);
    const quotes = dedupeQuotes(inScene.filter((q) => q.verified));
    const discardedQuotes = inScene.filter((q) => !q.verified);
    const get = (name: string) => tagText(text, name, tag.start, tag.end);
    const refsOf = (name: string) => toUtteranceIndices(parseUtteranceList(get(name)), utterances.length);
    scenes.push({
      type,
      items: parseNumbers(get("items")).filter((n) => n >= 1 && n <= 5),
      context: get("context"),
      quotes,
      discardedQuotes,
      quotedTextInBody: get("quote"),
      observation: get("observation"),
      reaction: get("reaction"),
      reading: get("reading"),
      asChoice: type === "次に試せる所" ? get("as_choice") || null : null,
      // よく表れた所には問いを置かない（決まり 6）。書かれていても使わない
      question: type === "次に試せる所" ? get("question") : "",
      refs: { reading: refsOf("reading_refs"), observation: refsOf("observation_refs"), reaction: refsOf("reaction_refs") },
      record: { whyChosen: get("why_chosen"), runnerUp: toUtteranceIndices(parseNumbers(get("runner_up")), utterances.length) },
    });
  }
  const noScene = tagText(text, "no_scene") || null;
  const flow = tagText(text, "flow")
    .split(/\r?\n/)
    // 行の頭の箇条の印（「- 」「・」「1. 」「2）」）だけを外す。「5月模試」のような本文の数字は残す
    .map((l) => l.replace(/^(?:[-・*]+\s*|\d+[.．、)）]\s*)/, "").trim())
    .filter((l) => l !== "");
  const summary = tagText(text, "summary");
  // 事情を尋ねる問いは 11/8 に外した（AI に書かせない）。書かれていても読むだけで、画面には出さない
  const extraQuestion = tagText(text, "extra_question") || null;
  // 文の中の「発話 n」が、発話の並びの範囲にあるか（番号のずれの見張り）
  const utteranceRefs = checkUtteranceRefs(
    [...scenes.flatMap((s) => [s.context, s.observation, s.reaction, s.reading, s.asChoice, s.question, s.record.whyChosen]), noScene, summary, ...flow, extraQuestion],
    utterances.length,
  );
  return {
    scenes,
    noScene,
    summary,
    flow,
    extraQuestion,
    utteranceRefs,
    quoteStats: {
      generated: all.length,
      discarded: all.filter((x) => !x.quote.verified).length,
      scenesWithoutQuote: scenes.filter((s) => s.quotes.length === 0).length,
    },
    rawText: text,
  };
}

/** 工程 1 を呼ぶ。 */
export async function runStep1(t: Transcript, opts: Step1Options = {}): Promise<Step1Result> {
  const doc = makeDocument(blockTexts(t.utterances), "面談の文字起こし");
  const r = await callCited({
    system: step1System(t.kind),
    user: [doc, { type: "text", text: step1UserText(t.kind) }],
    effort: opts.effort ?? "high",
    label: "工程 1",
    onText: opts.onText,
    onCitation: opts.onCitation,
  });
  const parsed = guardStep1(parseStep1(r.text, r.segments, t.utterances), t.utterances);
  return { ...parsed, firstCitationMs: r.firstCitationMs, meta: r.meta };
}
