// 工程 2：点（画面 2 の下）。Messages API、構造化出力。
// 受け取る：工程 1 と同じ文字起こし、工程 1 の場面、採点表。渡さない：本人の自己採点（決まり 10）。
// 返す：5 項目ごとに点か「判定しない」、一読で分かる説明（発話番号なし）と発話番号で指した理由、根拠の発話番号。気づきの持ち主。倫理チェックの 1 行。合計はアプリが計算する（決まり 8）。

import { callStructured } from "./claude.mts";
import { guardStep2 } from "./guard.mts";
import { STEP2_SCHEMA, step2System, step2User } from "./prompts.mts";
import { computeTotal } from "./rubric.mts";
import type { EthicsLevel, ItemNumber, ItemScore, Scene, Step2Result, Transcript } from "./types.mts";
import { toUtteranceIndices } from "./utterance-no.mts";

type Raw = {
  items: { item: number; judged: boolean; score: number; plain?: string; reason: string; utterances: number[] }[];
  insight_owner: "講師" | "相手" | "両方";
  ethics: { level: EthicsLevel; text: string; viewpoint: string; utterances: number[] };
};

/** 構造化出力を結果の形にする（テストで守る）。5 項目がそろわなければ、無い項目は「判定しない」で埋め、理由に書く。 */
export function parseStep2(raw: Raw, utteranceCount: number): Omit<Step2Result, "meta" | "withheld" | "unverifiedQuotes"> {
  const items: ItemScore[] = ([1, 2, 3, 4, 5] as ItemNumber[]).map((n) => {
    const r = raw.items.find((i) => i.item === n);
    if (!r) return { item: n, score: null, reason: "（返事に項目が無かった）", utterances: [] };
    const score = r.judged && Number.isInteger(r.score) && r.score >= 1 && r.score <= 5 ? r.score : null;
    const plain = (r.plain ?? "").trim();
    return {
      item: n,
      score,
      ...(plain ? { plain } : {}),
      reason: r.reason,
      utterances: toUtteranceIndices(r.utterances ?? [], utteranceCount),
    };
  });
  const level: EthicsLevel = (["問題なし", "判断できない", "確かめてください", "所属の手順"] as EthicsLevel[]).includes(raw.ethics.level) ? raw.ethics.level : "判断できない";
  const ethicsText = level === "所属の手順" ? "この話は、所属の手順に沿って扱ってください" : raw.ethics.text;
  return {
    items,
    total: computeTotal(items),
    insightOwner: raw.insight_owner,
    ethics: {
      level,
      text: ethicsText,
      viewpoint: raw.ethics.viewpoint || null,
      utterances: toUtteranceIndices(raw.ethics.utterances ?? [], utteranceCount),
    },
  };
}

export async function runStep2(t: Transcript, scenes: Scene[], opts: { firstMeeting?: boolean; onText?: (delta: string) => void } = {}): Promise<Step2Result> {
  const r = await callStructured<Raw>({
    system: step2System(t.kind),
    user: step2User(t.utterances, scenes, opts.firstMeeting ?? true),
    schema: STEP2_SCHEMA,
    effort: "high",
    label: "工程 2",
    onText: opts.onText,
  });
  return { ...guardStep2(parseStep2(r.data, t.utterances.length), t.utterances), meta: r.meta };
}
