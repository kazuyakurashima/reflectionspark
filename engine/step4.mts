// 工程 4：次の面談で（画面 5）。Messages API、citations。
// 受け取る：今回の文字起こし（発話ブロック）、前回の Spark とできたかの基準、前回の場面（ふつうの文として）。
// 渡さない：本人の自己評価（四つの言葉と点）、前回の AI の点と判定（決まり 10）。
// 返す：判定、根拠の引用（照合済み）、なぜの一文、5 項目の点（項目 5 が中心）、（あれば）相手の前回の行動の 1 行。

import { callCited, makeDocument } from "./claude.mts";
import type { TextSegment } from "./claude.mts";
import { blockTexts, dedupeQuotes, verifyCitation } from "./citations.mts";
import { step4System, step4UserText } from "./prompts.mts";
import { computeTotal } from "./rubric.mts";
import { findTags, parseNumbers, tagText } from "./tagged.mts";
import type { FollowUpVerdict, ItemNumber, ItemScore, Quote, Spark, Step4Result, Transcript, Utterance } from "./types.mts";

const VERDICTS: FollowUpVerdict[] = ["できた", "一部", "まだ", "場面がなかった"];

export function parseStep4(text: string, segments: TextSegment[], utterances: Utterance[]): Omit<Step4Result, "meta" | "firstCitationMs"> {
  const all: Quote[] = [];
  for (const seg of segments) for (const c of seg.citations) all.push(verifyCitation(c, utterances));
  const quotes = dedupeQuotes(all.filter((q) => q.verified));
  const discardedQuotes = all.filter((q) => !q.verified);
  const v = tagText(text, "verdict").replace(/\s/g, "");
  const verdict = VERDICTS.find((x) => v.includes(x)) ?? "場面がなかった";
  const items: ItemScore[] = ([1, 2, 3, 4, 5] as ItemNumber[]).map((n) => {
    const tag = findTags(text, "item").find((t) => Number(t.attrs.n) === n);
    if (!tag) return { item: n, score: null, reason: "（返事に項目が無かった）", utterances: [] };
    const s = (tag.attrs.score ?? "").trim();
    const num = Number(s);
    const score = Number.isInteger(num) && num >= 1 && num <= 5 ? num : null;
    return {
      item: n,
      score,
      reason: tag.inner.trim(),
      utterances: parseNumbers(tag.attrs.utterances ?? "").filter((u) => u >= 0 && u < utterances.length),
    };
  });
  return {
    verdict,
    quotes,
    discardedQuotes,
    why: tagText(text, "why"),
    items,
    total: computeTotal(items),
    otherPersonLine: tagText(text, "other_line") || null,
    quoteStats: { generated: all.length, discarded: discardedQuotes.length },
    rawText: text,
  };
}

export async function runStep4(t: Transcript, spark: Spark, opts: { onText?: (d: string) => void } = {}): Promise<Step4Result> {
  const doc = makeDocument(blockTexts(t.utterances), "今回の面談の文字起こし");
  const r = await callCited({
    system: step4System(t.kind),
    user: [doc, { type: "text", text: step4UserText(t.kind, spark) }],
    effort: "high",
    label: "工程 4",
    onText: opts.onText,
  });
  return { ...parseStep4(r.text, r.segments, t.utterances), firstCitationMs: r.firstCitationMs, meta: r.meta };
}
