// 仮の出力。API キーが無いときに Route Handler が返す。エンジンの出力と同じ形（engine/types.mts）で、
// 本物の出力にそのまま差し替えられるようにする。中身は「（仮の出力）」と明記し、分析の読みとしては使わない。
// SDK は読み込まない（ブラウザ側に持ち込める形にはしないが、サーバーで鍵なしに動く）。

import { blockText, verifyCitation } from "./citations.mts";
import { applyCorrections } from "./step0.mts";
import { parseStep3 } from "./step3.mts";
import { computeTotal } from "./rubric.mts";
import type { Correction, Guess, ItemNumber, ItemScore, MeetingKind, Quote, Scene, Spark, Step0cResult, Step1Result, Step2Result, Step3Result, Step4Result, Transcript, Utterance } from "./types.mts";
import { SPEAKER_LABELS } from "./types.mts";

export const MOCK_NOTE = "（仮の出力）";

const mockMeta = { model: "mock", ms: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** 聞き違いの例（山場のサンプルに実際に出る語）。本文にあるときだけ直す。 */
const MOCK_CORRECTIONS: [string, string][] = [
  ["難航", "南高"],
  ["南航", "南高"],
  ["南港", "南高"],
  ["平岸の私立", "併願の私立"],
  ["通のも楽", "通うのも楽"],
];

const MOCK_GUESSES: [string, string, string][] = [
  ["ニバス", "ミニバス", "音が近い語。小学生のバスケの話"],
  ["電池に入る", "ベンチに入る", "音が近い語。部活の試合の話"],
  ["内心も大事", "内申も大事", "同音。進路の話"],
];

/**
 * 仮の工程 0：文の区切り（。！？）で発話に分け、話者を交互に付ける。確からしさは「中」、一部を「低」にする。
 * 本物の 0a は文脈で話者を付けるので、ここでの話者は当てにならない（画面 1 で本人が直す前提の仮）。
 */
export function mockStep0(raw: string, kind: MeetingKind): Transcript {
  const { self, other } = SPEAKER_LABELS[kind];
  const text = raw.replace(/^﻿/, "");
  const cps = [...text];
  const utterances: Utterance[] = [];
  let start = 0;
  let i = 0;
  const push = (s: number, e: number) => {
    let a = s;
    let b = e;
    while (a < b && /\s/.test(cps[a])) a++;
    while (b > a && /\s/.test(cps[b - 1])) b--;
    if (a >= b) return;
    const original = cps.slice(a, b).join("");
    const n = utterances.length;
    const low = n % 7 === 3;
    utterances.push({
      index: n,
      speaker: n % 2 === 0 ? self : other,
      text: original,
      original,
      confidence: low ? "低" : "中",
      confidenceReason: low ? `${MOCK_NOTE}文の区切りだけで話者を決めた` : undefined,
      check: low ? ["話者の確からしさが低い"] : ["話者の確からしさが中"],
      memoSpan: [a, b],
    });
  };
  while (i < cps.length) {
    const c = cps[i];
    i++;
    if (c === "。" || c === "！" || c === "？" || c === "!" || c === "?") {
      // 続く「」や空白は次へ
      push(start, i);
      start = i;
    }
  }
  push(start, cps.length);
  if (utterances.length === 0) {
    throw new Error("文字起こしが空です");
  }
  const proposed: Correction[] = [];
  for (const u of utterances) {
    for (const [before, after] of MOCK_CORRECTIONS) {
      if (u.original.includes(before)) proposed.push({ index: u.index, kind: `同音の取り違え${MOCK_NOTE}`, before, after });
    }
  }
  const step0b = applyCorrections(utterances, proposed);
  return { kind, raw: text, utterances, multipleOthers: false, step0b, step0c: null };
}

/** 仮の工程 0c：本文にある語にだけ推測を付ける。工程 0 とは別に回す。 */
export function mockStep0c(t: Transcript): Step0cResult {
  const guesses: Guess[] = [];
  for (const u of t.utterances) {
    for (const [fragment, guess, clue] of MOCK_GUESSES) {
      if (u.original.includes(fragment)) guesses.push({ index: u.index, kind: "崩れ", fragment, guess, clue: `${MOCK_NOTE}${clue}` });
    }
  }
  return { summary: `${MOCK_NOTE}会話全体の要旨は、本物の工程 0c がここに書きます。`, guesses };
}

function quoteOf(u: Utterance, utterances: Utterance[]): Quote {
  return verifyCitation(
    { type: "content_block_location", cited_text: blockText(u), document_index: 0, document_title: null, start_block_index: u.index, end_block_index: u.index + 1, file_id: null },
    utterances,
  );
}

function pickSelf(utterances: Utterance[], self: string, prefer: RegExp, fallbackRatio: number): Utterance {
  const selfs = utterances.filter((u) => u.speaker === self && u.text);
  const hit = selfs.find((u) => prefer.test(u.text ?? ""));
  if (hit) return hit;
  return selfs[Math.min(selfs.length - 1, Math.floor(selfs.length * fallbackRatio))] ?? utterances[0];
}

/** 仮の工程 1：本文に実際にある発話を引用し（照合も通す）、読みと問いは仮の文にする。 */
export function mockStep1(t: Transcript): Step1Result {
  const { self } = SPEAKER_LABELS[t.kind];
  const good = pickSelf(t.utterances, self, /そっか|そうなんだ|なるほど/, 0.2);
  let next = pickSelf(t.utterances, self, /大丈夫|頑張ろう|やってみて|まずは/, 0.7);
  if (next.index === good.index) next = pickSelf(t.utterances, self, /^$/, 0.8);
  const scene = (type: Scene["type"], u: Utterance, items: number[]): Scene => ({
    type,
    items,
    context: `${MOCK_NOTE}発話 ${u.index} の前後で話されていたことを、本物の出力はここに一行で書きます。`,
    quotes: [quoteOf(u, t.utterances)],
    discardedQuotes: [],
    quotedTextInBody: u.text ?? "",
    observation: `${MOCK_NOTE}本人が何をしたかの事実だけを、本物の出力はここに書きます。`,
    reaction: `${MOCK_NOTE}直後の相手の発話がどう続いたかを、本物の出力はここに書きます。`,
    reading: `${MOCK_NOTE}ここで何が起きたかの読みを、本物の出力は「〜と読める」の形でここに書きます。二文目以降は押すと開きます。`,
    asChoice: type === "次に試せる所" ? `${MOCK_NOTE}本人にその選び方の理由があった可能性を、決めつけずにここに書きます。` : null,
    question:
      type === "よく表れた所" ? `${MOCK_NOTE}この場面で、相手の言葉をどう受け取っていましたか。` : `${MOCK_NOTE}次に同じ場面が来たら、何を試しますか。`,
    record: { whyChosen: `${MOCK_NOTE}選んだ理由（画面に出さない）`, runnerUp: [] },
  });
  return {
    scenes: [scene("よく表れた所", good, [1]), scene("次に試せる所", next, [])],
    noScene: null,
    summary: `${MOCK_NOTE}よく表れた所を先に、次に試せる所を後に、2 文で本物の出力はここに書きます。`,
    flow: [`${MOCK_NOTE}主題`, `${MOCK_NOTE}転機`, `${MOCK_NOTE}終わり方`],
    extraQuestion: null,
    quoteStats: { generated: 2, discarded: 0, scenesWithoutQuote: 0 },
    firstCitationMs: null,
    rawText: "",
    meta: mockMeta,
    withheld: [],
    unverifiedQuotes: [],
  };
}

/** 仮の工程 2：項目 1〜4 は 3、項目 5 は判定しない。合計はアプリが計算する。 */
export function mockStep2(t: Transcript, firstMeeting = true): Step2Result {
  const items: ItemScore[] = ([1, 2, 3, 4, 5] as ItemNumber[]).map((n) => ({
    item: n,
    score: n === 5 && firstMeeting ? null : 3,
    reason: n === 5 && firstMeeting ? `${MOCK_NOTE}初回の面談なので、前回決めたことは判定しない` : `${MOCK_NOTE}理由の一行を、本物の出力はここに書きます`,
    utterances: n === 5 && firstMeeting ? [] : [Math.min(t.utterances.length - 1, n * 2)],
  }));
  return {
    items,
    total: computeTotal(items),
    insightOwner: "両方",
    ethics: { level: "問題なし", text: `${MOCK_NOTE}問題なし`, viewpoint: null, utterances: [] },
    meta: mockMeta,
    withheld: [],
    unverifiedQuotes: [],
  };
}

/** 仮の工程 3：候補 3 つ。形（もし〜なら、〜する／セリフの例／できたかの基準）は本物と同じ。本人の答えは先頭の候補の基準に写す。 */
export function mockStep3(scene: Scene, answer: string): Step3Result {
  const head = answer.trim() ? `本人の答え「${[...answer.trim()].slice(0, 20).join("")}…」を踏まえた候補。` : "本人の答えが空だったので、場面と読みから作った候補。";
  const parsed = parseStep3({
    candidates: [
      {
        condition: "相手の返事が「はい」だけになったら",
        action: "説明を止めて「いまの話、どう思う？」と聞く",
        lines: ["いまの話、どう思う？", "ここまでで、引っかかる所ある？", "自分の言葉だと、どうなる？"],
        criterion: `${MOCK_NOTE}${head}次の面談で、相手の短い返事の直後に、本人の問いが文字起こしにある。`,
      },
      {
        condition: "相手が望みを口にしたのに、それに向けた行動が出ていないとき",
        action: "望みと今の行動の差をそのまま返して、どう思うかを聞く",
        lines: ["行きたいんだよね。でも、いまは〇〇。この差、どう思う？", "やりたいことと、やってることが違うように聞こえた。どう？"],
        criterion: `${MOCK_NOTE}次の面談で、相手の望みの直後に、本人が差を言葉にして問う発話がある。`,
      },
      {
        condition: "自分の問いに相手が「えっと」と答え始めたら",
        action: "解説を足さずに「うん、それで？」と返す",
        lines: ["うん、それで？", "うん。続けて。"],
        criterion: `${MOCK_NOTE}次の面談で、相手の「えっと」の直後の本人の発話が一文以内で、問いか相づちだけになっている。`,
      },
    ],
  });
  void scene;
  return { ...parsed, meta: mockMeta, withheld: [], unverifiedQuotes: [] };
}

/** 仮の工程 4：本人の発話を 1 つ引用し（照合も通す）、判定は「一部」、点は項目 5 を含めて仮の値。 */
export function mockStep4(t: Transcript, spark: Spark): Step4Result {
  const { self } = SPEAKER_LABELS[t.kind];
  const u = pickSelf(t.utterances, self, /どう思う|どう|思う/, 0.6);
  const items: ItemScore[] = ([1, 2, 3, 4, 5] as ItemNumber[]).map((n) => ({
    item: n,
    score: 3,
    reason: n === 5 ? `${MOCK_NOTE}前回決めたこと（${[...spark.sentence].slice(0, 24).join("")}…）に触れたかを、本物の出力はここに書きます` : `${MOCK_NOTE}理由の一行を、本物の出力はここに書きます`,
    utterances: [u.index],
  }));
  return {
    verdict: "一部",
    quotes: [quoteOf(u, t.utterances)],
    discardedQuotes: [],
    why: `${MOCK_NOTE}前回の行動がどう現れたかの一文を、本物の出力はここに書きます。`,
    items,
    total: computeTotal(items),
    otherPersonLine: null,
    quoteStats: { generated: 1, discarded: 0 },
    firstCitationMs: null,
    rawText: "",
    meta: mockMeta,
    withheld: [],
    unverifiedQuotes: [],
  };
}
