// 工程 3：行動の候補（画面 4）。Messages API、構造化出力。
// 受け取る：次に試せる場面（引用・読み・問い）、本人の答え。（あれば）記録から似た場面の本人の発言。渡さない：本人の自己採点。
// 返す：候補 2〜3。「もし（場面）なら、（行動）する」、セリフの例 2〜3、できたかの基準。言葉に表れない行動は落とす。

import { callStructured } from "./claude.mts";
import { neighborsOf } from "./citations.mts";
import { STEP3_SCHEMA, step3System, step3User } from "./prompts.mts";
import type { Candidate, Scene, Step3Result, Transcript } from "./types.mts";

type Raw = { candidates: { condition: string; action: string; lines: string[]; criterion: string }[] };

/** 言葉に表れない行動の目印。セリフや発話の動詞があれば残す。 */
const NON_VERBAL = /(待つ|待って|黙る|黙って|沈黙|表情|うなず|頷|目を見|視線|身を乗り出|笑顔|姿勢|深呼吸)/;
const VERBAL = /(「|『|言う|言い|聞く|聞き|返す|返し|尋ね|伝え|問う|問い|話す|話し|確かめ|口にする|声をかけ|呼びかけ|質問)/;

export function makeSentence(condition: string, action: string): string {
  let cond = condition.trim().replace(/^もし/, "").replace(/[、,。]+$/, "");
  const act = action.trim().replace(/[。]+$/, "");
  if (!/(なら|たら|とき|ときは|時|場合|場合は|際|際は|ら)$/.test(cond)) cond = `${cond}なら`;
  return `もし${cond}、${act}。`;
}

/** 構造化出力を候補の形にし、言葉に表れない行動を落とす（テストで守る） */
export function parseStep3(raw: Raw): Omit<Step3Result, "meta"> {
  const candidates: Candidate[] = [];
  const dropped: Step3Result["dropped"] = [];
  for (const c of raw.candidates ?? []) {
    const cand: Candidate = {
      condition: c.condition.trim(),
      action: c.action.trim(),
      sentence: makeSentence(c.condition, c.action),
      lines: (c.lines ?? []).map((l) => l.trim()).filter((l) => l !== ""),
      criterion: (c.criterion ?? "").trim(),
    };
    if (NON_VERBAL.test(cand.action) && !VERBAL.test(cand.action)) {
      dropped.push({ candidate: cand, reason: "言葉に表れない行動（次の面談の文字起こしで確かめられない）" });
      continue;
    }
    if (cand.lines.length === 0) {
      dropped.push({ candidate: cand, reason: "セリフの例が無い" });
      continue;
    }
    candidates.push(cand);
  }
  return { candidates, dropped };
}

export async function runStep3(t: Transcript, scene: Scene, answer: string, memoryNotes: string[] = []): Promise<Step3Result> {
  const anchor = scene.quotes[0]?.index;
  const neighbors = anchor === undefined ? { before: null, after: null } : neighborsOf(anchor, t.utterances);
  const r = await callStructured<Raw>({
    system: step3System(t.kind),
    user: step3User(scene, answer, neighbors, memoryNotes),
    schema: STEP3_SCHEMA,
    effort: "high",
    label: "工程 3",
  });
  return { ...parseStep3(r.data), meta: r.meta };
}
