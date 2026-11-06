// 工程 3：行動の候補（画面 4）。Messages API、構造化出力。
// 受け取る：次に試せる場面（引用・読み・問い）、本人の答え。（あれば）夢で整理した「繰り返す場面」と根拠の発話。渡さない：本人の自己採点、点の控え。
// 返す：候補 2〜3。「もし（場面）なら、（行動）する」、セリフの例 2〜3、できたかの基準。言葉に表れない行動は落とす。
// 記録を渡したときは、候補ごとの前の面談の発話の札と、今回の場面と同じ形の発話の札も返させ、アプリが札から記録の原文を引く（AI が書いた引用文は出さない。決まり 1）。

import { callStructured } from "./claude.mts";
import { neighborsOf } from "./citations.mts";
import { guardStep3 } from "./guard.mts";
import { resolvePreviousWords } from "./memory-read.mts";
import type { ParsedRecord, Step3Memory } from "./memory-read.mts";
import { STEP3_PAST_SCENES_SCHEMA, STEP3_SCHEMA, step3System, step3User } from "./prompts.mts";
import type { Candidate, PreviousWords, Scene, Step3Result, Transcript } from "./types.mts";

type Raw = { candidates: { condition: string; action: string; lines: string[]; criterion: string; basis?: string; previous_ref?: string }[]; repeat_refs?: string[] };

/** 今回の場面と同じ形として出す、前の面談の場面の上限 */
const MAX_REPEATS = 2;

/** 言葉に表れない行動の目印。セリフや発話の動詞があれば残す。 */
const NON_VERBAL = /(待つ|待って|黙る|黙って|沈黙|表情|うなず|頷|目を見|視線|身を乗り出|笑顔|姿勢|深呼吸)/;
const VERBAL = /(「|『|言う|言い|聞く|聞き|返す|返し|尋ね|伝え|問う|問い|話す|話し|確かめ|口にする|声をかけ|呼びかけ|質問)/;

/** 場面や行動の文に混ざった「どこから作ったか」の注記（括弧書き）。持ち帰る一文には入れず、basis に回す */
const BASIS_NOTE = /\s*[（(]([^（()）]*(?:本人の答え|場面と読み)[^（()）]*)[）)]\s*/g;

/** 文から「どこから作ったか」の注記を外し、外した注記を返す */
export function splitBasisNote(text: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const out = (text ?? "").replace(BASIS_NOTE, (_m, inner: string) => {
    notes.push(inner.trim());
    return "";
  });
  return { text: out.trim(), notes };
}

export function makeSentence(condition: string, action: string): string {
  let cond = splitBasisNote(condition)
    .text.replace(/^もし/, "")
    .replace(/[、,。]+$/, "")
    // 「〜したときなら」「〜したらなら」は「なら」が重なるので外す
    .replace(/(とき|時|場合|際|たら)(?:は)?なら$/, "$1");
  const act = splitBasisNote(action).text.replace(/[。]+$/, "");
  // 末尾に括弧書きが残っているときは、その手前の言葉で「なら」が要るかを見る
  const tail = cond.replace(/[（(][^（()）]*[）)]$/, "");
  if (!/(なら|たら|とき|ときは|時|場合|場合は|際|際は|ら)$/.test(tail)) cond = `${cond}なら`;
  return `もし${cond}、${act}。`;
}

/** 構造化出力を候補の形にし、言葉に表れない行動を落とす（テストで守る） */
export function parseStep3(raw: Raw): Omit<Step3Result, "meta" | "withheld" | "unverifiedQuotes"> {
  const candidates: Candidate[] = [];
  const dropped: Step3Result["dropped"] = [];
  for (const c of raw.candidates ?? []) {
    const cond = splitBasisNote(c.condition);
    const act = splitBasisNote(c.action);
    // どこから作ったか。AI が basis に書いたものを使い、無ければ文に混ざっていた注記を使う
    const basis = (c.basis ?? "").trim() || [...cond.notes, ...act.notes].join("、");
    const cand: Candidate = {
      condition: cond.text,
      action: act.text,
      sentence: makeSentence(c.condition, c.action),
      lines: (c.lines ?? []).map((l) => l.trim()).filter((l) => l !== ""),
      criterion: (c.criterion ?? "").trim(),
      ...(basis ? { basis } : {}),
      ...(c.previous_ref?.trim() ? { previousRef: c.previous_ref.trim() } : {}),
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

/** 工程 3 が返した札を、記録の原文に置き換える。札が記録に無ければ添えない（決まり 1） */
export function attachPreviousWords(candidates: Candidate[], records: ParsedRecord[]): Candidate[] {
  return candidates.map(({ previousRef, ...c }) => {
    const previous = resolvePreviousWords(previousRef, records);
    return previous ? { ...c, previous } : c;
  });
}

/**
 * 工程 3 が返した「同じ形の場面」の札を、記録の原文に置き換える。札が記録に無ければ出さない（決まり 1）。
 * 同じ発話は 1 回だけ。候補に添えた発話は出さない（できた言葉と同じ形の場面に、同じ発話を並べない）。古い順に 2 つまで。
 */
export function resolveRepeats(refs: string[] | null | undefined, candidates: Candidate[], records: ParsedRecord[]): PreviousWords[] {
  const key = (p: PreviousWords) => `${p.interviewId}｜${p.utterance}`;
  const seen = new Set(candidates.flatMap((c) => (c.previous ? [key(c.previous)] : [])));
  const out: PreviousWords[] = [];
  for (const ref of refs ?? []) {
    const p = resolvePreviousWords(ref, records);
    if (!p || seen.has(key(p))) continue;
    seen.add(key(p));
    out.push(p);
    if (out.length === MAX_REPEATS) break;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.utterance - b.utterance);
}

export async function runStep3(t: Transcript, scene: Scene, answer: string, memory: Step3Memory | null = null): Promise<Step3Result> {
  const anchor = scene.quotes[0]?.index;
  const neighbors = anchor === undefined ? { before: null, after: null } : neighborsOf(anchor, t.utterances);
  const r = await callStructured<Raw>({
    system: step3System(t.kind, memory !== null),
    user: step3User(scene, answer, neighbors, memory?.pastScenes ?? null),
    schema: memory ? STEP3_PAST_SCENES_SCHEMA : STEP3_SCHEMA,
    effort: "high",
    label: "工程 3",
  });
  const guarded = guardStep3(parseStep3(r.data), t.utterances);
  const candidates = attachPreviousWords(guarded.candidates, memory?.records ?? []);
  const repeats = resolveRepeats(r.data.repeat_refs, candidates, memory?.records ?? []);
  return { ...guarded, candidates, ...(repeats.length > 0 ? { repeats } : {}), meta: r.meta };
}
