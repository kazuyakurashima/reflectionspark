// 本番の出力の検査（docs/設計書.md「工程の間で守ること」「見せ方の決まり」）。
// 1. 「」『』の中の言葉が、その文字起こしの発話の原文に無ければ、「」を外して出す（引用として見せない。決まり 1）。
//    照合した引用は citations だけで、AI が本文に書いた「」は検証されていないため。
// 2. 人物の性質の言葉（決まり 3）が入った文は出さず、「表示を控えました」と出し、元の文を記録に残す。
// 順番は 1 → 2（検証されなかった「」を外してから検査する。原文と一致した「」の中は、言った言葉なので検査しない）。

import { scanText } from "./forbidden-words.mts";
import type { Scene, Step0cResult, Step1Result, Step2Result, Step3Result, Step4Result, Utterance } from "./types.mts";

export const WITHHELD_NOTICE = "表示を控えました（人物の性質を言い表す言葉が含まれていたため。記録には残しています）";

export type WithheldText = {
  field: string;
  /** 当たった言葉 */
  words: string[];
  /** 元の文（画面には出さない） */
  original: string;
};

export type UnverifiedQuote = {
  field: string;
  /** 「」を外した言葉 */
  text: string;
};

export type GuardLog = { withheld: WithheldText[]; unverifiedQuotes: UnverifiedQuote[] };

const BRACKETS = /「([^「」]*)」|『([^『』]*)』/g;

/** 「」『』の中の言葉が、発話の原文（整形後の本文か元の文）に含まれているか */
export function quoteIsInTranscript(inner: string, utterances: Utterance[]): boolean {
  const q = inner.trim();
  if (q === "") return false;
  return utterances.some((u) => (u.text ?? "").includes(q) || u.original.includes(q));
}

/** 発話の原文に無い「」『』を外す。 */
export function stripUnverifiedQuotes(text: string, utterances: Utterance[], field: string): { text: string; stripped: UnverifiedQuote[] } {
  const stripped: UnverifiedQuote[] = [];
  const out = text.replace(BRACKETS, (m, a: string | undefined, b: string | undefined) => {
    const inner = a ?? b ?? "";
    if (quoteIsInTranscript(inner, utterances)) return m;
    stripped.push({ field, text: inner });
    return inner;
  });
  return { text: out, stripped };
}

/** 1 つの欄を検査する。「」を外し、性質の言葉があれば文を差し替える。 */
export function guardText(text: string, field: string, utterances: Utterance[], log: GuardLog, opts: { stripQuotes?: boolean } = {}): string {
  if (!text) return text;
  let t = text;
  if (opts.stripQuotes !== false) {
    const s = stripUnverifiedQuotes(t, utterances, field);
    t = s.text;
    log.unverifiedQuotes.push(...s.stripped);
  }
  const hits = scanText(t, field);
  if (hits.length > 0) {
    log.withheld.push({ field, words: [...new Set(hits.map((h) => h.word))], original: text });
    return WITHHELD_NOTICE;
  }
  return t;
}

function guardScene(sc: Scene, i: number, utterances: Utterance[], log: GuardLog): Scene {
  const f = (name: string) => `scenes[${i}].${name}`;
  const reading = guardText(sc.reading, f("reading"), utterances, log);
  return {
    ...sc,
    context: guardText(sc.context, f("context"), utterances, log),
    observation: guardText(sc.observation, f("observation"), utterances, log),
    reaction: guardText(sc.reaction, f("reaction"), utterances, log),
    reading,
    // 要の一句は、守った後の読みにそのまま残っているときだけ目立たせる（読みを控えた・「」を外したときは目立たせない）
    ...(sc.readingKey !== undefined ? { readingKey: sc.readingKey && reading.includes(sc.readingKey) ? sc.readingKey : null } : {}),
    asChoice: sc.asChoice === null ? null : guardText(sc.asChoice, f("asChoice"), utterances, log),
    question: guardText(sc.question, f("question"), utterances, log),
    record: { ...sc.record, whyChosen: guardText(sc.record.whyChosen, f("record.whyChosen"), utterances, log) },
  };
}

export function guardStep1<T extends Omit<Step1Result, "meta" | "firstCitationMs" | "withheld" | "unverifiedQuotes">>(r: T, utterances: Utterance[]): T & GuardLog {
  const log: GuardLog = { withheld: [], unverifiedQuotes: [] };
  return {
    ...r,
    scenes: r.scenes.map((sc, i) => guardScene(sc, i, utterances, log)),
    noScene: r.noScene === null ? null : guardText(r.noScene, "noScene", utterances, log),
    summary: guardText(r.summary, "summary", utterances, log),
    flow: r.flow.map((f, i) => guardText(f, `flow[${i}]`, utterances, log)),
    extraQuestion: r.extraQuestion === null ? null : guardText(r.extraQuestion, "extraQuestion", utterances, log),
    ...log,
  };
}

export function guardStep2<T extends Omit<Step2Result, "meta" | "withheld" | "unverifiedQuotes">>(r: T, utterances: Utterance[]): T & GuardLog {
  const log: GuardLog = { withheld: [], unverifiedQuotes: [] };
  return {
    ...r,
    items: r.items.map((it) => ({
      ...it,
      ...(it.plain ? { plain: guardText(it.plain, `items[${it.item}].plain`, utterances, log) } : {}),
      reason: guardText(it.reason, `items[${it.item}].reason`, utterances, log),
    })),
    ethics: {
      ...r.ethics,
      text: r.ethics.level === "所属の手順" ? r.ethics.text : guardText(r.ethics.text, "ethics.text", utterances, log),
      viewpoint: r.ethics.viewpoint === null ? null : guardText(r.ethics.viewpoint, "ethics.viewpoint", utterances, log),
    },
    ...log,
  };
}

/** 工程 3：候補の場面・行動・基準は、相手が誰でも起こりうる形で書くので「」を外さない（性質の言葉だけ検査する） */
export function guardStep3<T extends Omit<Step3Result, "meta" | "withheld" | "unverifiedQuotes">>(r: T, utterances: Utterance[]): T & GuardLog {
  const log: GuardLog = { withheld: [], unverifiedQuotes: [] };
  const no = { stripQuotes: false };
  return {
    ...r,
    candidates: r.candidates.map((c, i) => ({
      ...c,
      condition: guardText(c.condition, `candidates[${i}].condition`, utterances, log, no),
      action: guardText(c.action, `candidates[${i}].action`, utterances, log, no),
      sentence: guardText(c.sentence, `candidates[${i}].sentence`, utterances, log, no),
      lines: c.lines.map((l, j) => guardText(l, `candidates[${i}].lines[${j}]`, utterances, log, no)),
      criterion: guardText(c.criterion, `candidates[${i}].criterion`, utterances, log, no),
      ...(c.basis ? { basis: guardText(c.basis, `candidates[${i}].basis`, utterances, log, no) } : {}),
    })),
    ...log,
  };
}

export function guardStep4<T extends Omit<Step4Result, "meta" | "firstCitationMs" | "withheld" | "unverifiedQuotes">>(r: T, utterances: Utterance[]): T & GuardLog {
  const log: GuardLog = { withheld: [], unverifiedQuotes: [] };
  return {
    ...r,
    why: guardText(r.why, "why", utterances, log),
    items: r.items.map((it) => ({ ...it, reason: guardText(it.reason, `items[${it.item}].reason`, utterances, log) })),
    otherPersonLine: r.otherPersonLine === null ? null : guardText(r.otherPersonLine, "otherPersonLine", utterances, log),
    ...log,
  };
}

/** 工程 0c：要旨と手がかりを検査する。断片と推測は元の文の一部なので「」は扱わず、性質の言葉だけ見る */
export function guardStep0c(r: Step0cResult, utterances: Utterance[]): Step0cResult & GuardLog {
  const log: GuardLog = { withheld: [], unverifiedQuotes: [] };
  const no = { stripQuotes: false };
  return {
    ...r,
    summary: guardText(r.summary, "summary", utterances, log, no),
    guesses: r.guesses.map((g, i) => ({ ...g, clue: guardText(g.clue, `guesses[${i}].clue`, utterances, log, no) })),
    ...log,
  };
}
