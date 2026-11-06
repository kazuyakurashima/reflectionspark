import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { blockText } from "./citations.mts";
import { WITHHELD_NOTICE } from "./guard.mts";
import { AI_READING_HEADING, assertNoSelfEvaluation, buildFactRecord, checkMarkdown, checkRecord, indexLine, quoteLineText, recordPath, renderRecord, withoutQuoteLines } from "./memory-record.mts";
import type { FactRecordInput } from "./memory-record.mts";
import type { ItemScore, Quote, Scene, Utterance } from "./types.mts";

const texts = [
  "今日は何から話そうか。",
  "模試、D 判定でした。正直、無理かもって。",
  "そっか、無理かもって思ったんだね。見たとき、どんな感じだった。",
  "数学が思ったより取れなくて。",
  "家ではどのくらいやってる。",
  "正直、ほぼゼロです。",
  "大丈夫、これからだよ。夏から頑張ろう。",
  "……はい。",
];
const utterances: Utterance[] = texts.map((t, i) => ({ index: i, speaker: i % 2 === 0 ? "講師" : "生徒", text: t, original: t, confidence: "高" as const, check: [], memoSpan: null }));

const quote = (index: number, endIndex = index + 1): Quote => ({
  citedText: utterances.slice(index, endIndex).map((u, k) => blockText(u, index + k)).join(""),
  text: utterances.slice(index, endIndex).map((u) => u.text).join("\n"),
  index,
  endIndex,
  verified: true,
});

const scene = (over: Partial<Scene>): Scene => ({
  type: "よく表れた所",
  items: [],
  context: "",
  quotes: [],
  discardedQuotes: [],
  quotedTextInBody: "",
  observation: "",
  reaction: "",
  reading: "",
  asChoice: null,
  question: "",
  record: { whyChosen: "", runnerUp: [] },
  ...over,
});

const items = (scores: (number | null)[]): ItemScore[] => scores.map((s, i) => ({ item: (i + 1) as ItemScore["item"], score: s, reason: "理由の文", utterances: [] }));

const baseInput = (over: Partial<FactRecordInput> = {}): FactRecordInput => ({
  interviewId: "student-a-1",
  kind: "生徒",
  order: 1,
  otherTag: "相手 A",
  followsInterviewId: null,
  status: "検証用・暫定",
  utterances,
  step1: {
    scenes: [
      scene({ type: "よく表れた所", context: "模試の判定の話。", quotes: [quote(2)], observation: "発話 1 の直後、講師は判定を見たときの様子を尋ねた。", reaction: "発話 3 で生徒は数学のことを続けた。", reading: "受け止めを先に聞いたと読める。" }),
      scene({ type: "次に試せる所", context: "家での勉強の話。", quotes: [quote(6)], observation: "発話 5 の直後、講師は励ましに移った。", reaction: "発話 7 で生徒は短く返した。", reading: "生徒が決めるところまで進まなかったと読める。", asChoice: "負担を増やさないつもりだった可能性があります。" }),
    ],
    noScene: null,
  },
  step2: { items: items([4, 3, 2, 3, null]) },
  chosenAction: { sentence: "もし相手が今の過ごし方を話したら、励ます前に一つ聞き返す。", criterion: "聞き返しの後に、相手が一文以上話している", origin: "検証用に置いた" },
  followUp: null,
  ...over,
});

describe("記録係に渡す事実の記録（工程 5、決まり 3・10・12）", () => {
  test("照合済みの引用と、発話番号から取った前後の発話だけが入る。文字起こしの全文は入らない", () => {
    const r = buildFactRecord(baseInput());
    assert.deepEqual(r.scenes[0].quotes, [{ index: 2, speaker: "講師", text: texts[2] }]);
    assert.deepEqual(r.scenes[0].neighbors.map((l) => l.index), [1, 3]);
    assert.deepEqual(r.scenes[1].neighbors.map((l) => l.index), [5, 7]);
    const md = renderRecord(r);
    // 引用も前後でもない発話（0・4）は記録に無い
    assert.equal(md.includes(texts[0]), false);
    assert.equal(md.includes(texts[4]), false);
    assert.equal(md.includes(`> 〔発話 2〕講師：${texts[2]}`), true);
    assert.equal(md.includes(`> 〔発話 7〕生徒：${texts[7]}`), true);
  });

  test("原文と一致しない引用は入れず、数を残す（決まり 1）", () => {
    const bad: Quote = { ...quote(2), text: "そっか、無理かもと思ったんだね。" };
    const unverified: Quote = { ...quote(4), verified: false };
    const input = baseInput();
    input.step1!.scenes[0].quotes = [bad, unverified];
    const r = buildFactRecord(input);
    assert.deepEqual(r.scenes[0].quotes, []);
    assert.equal(r.dropped.unverifiedQuotes, 2);
    assert.equal(renderRecord(r).includes("引用：なし（原文と一致した引用が無かった）"), true);
  });

  test("いくつかの発話にまたがる引用は発話ごとの行にし、前後は引用と重ねない", () => {
    const input = baseInput();
    input.step1!.scenes[0].quotes = [quote(2, 4)];
    const r = buildFactRecord(input);
    assert.deepEqual(r.scenes[0].quotes.map((l) => l.index), [2, 3]);
    assert.deepEqual(r.scenes[0].neighbors.map((l) => l.index), [1, 4]);
  });

  test("本人の自己採点・自己評価らしい欄があれば投げる（渡さない）", () => {
    assert.throws(() => buildFactRecord({ ...baseInput(), selfScore: 3 } as unknown as FactRecordInput), /記録係に渡せない欄/);
    assert.throws(() => assertNoSelfEvaluation({ followUp: { demoSelfEvaluation: { verdict: "一部" } } }), /demoSelfEvaluation/);
    assert.throws(() => assertNoSelfEvaluation({ a: [{ 自己評価: "できた" }] }), /自己評価/);
    assert.doesNotThrow(() => assertNoSelfEvaluation(baseInput()));
  });

  test("読みと点は「その回の AI の読み（仮説）」に分けて書き、外せる", () => {
    const r = buildFactRecord(baseInput());
    const md = renderRecord(r);
    const [facts, ai] = md.split(AI_READING_HEADING);
    assert.equal(facts.includes("受け止めを先に聞いたと読める。"), false);
    assert.equal(ai.includes("場面 1 の読み：受け止めを先に聞いたと読める。"), true);
    assert.equal(ai.includes("場面 2 を意図した選択として見ると："), true);
    assert.equal(ai.includes("項目 1＝4、項目 2＝3、項目 3＝2、項目 4＝3、項目 5＝判定しない"), true);
    assert.equal(facts.includes("項目 1＝4"), false);
    const factsOnly = renderRecord(r, { includeAiReading: false });
    assert.equal(factsOnly.includes(AI_READING_HEADING), false);
    assert.equal(factsOnly.includes("と読める"), false);
    assert.equal(factsOnly.includes("観察：発話 1 の直後、講師は判定を見たときの様子を尋ねた。"), true);
  });

  test("続きの面談：前回の行動、AI の判定、根拠の引用が事実に、なぜの一文は読みに入る。点は工程 4 のもの", () => {
    const r = buildFactRecord(
      baseInput({
        interviewId: "student-a-2",
        order: 2,
        followsInterviewId: "student-a-1",
        step2: null,
        chosenAction: null,
        followUp: {
          previousInterviewId: "student-a-1",
          previousAction: "もし相手が今の過ごし方を話したら、励ます前に一つ聞き返す。",
          criterion: null,
          step4: { verdict: "まだ", quotes: [quote(6)], why: "発話 5 の直後に励ましへ移ったため。", items: items([3, 3, 2, 3, 2]), otherPersonLine: null },
        },
      }),
    );
    assert.equal(r.followUp?.verdict, "まだ");
    assert.deepEqual(r.followUp?.quotes.map((l) => l.index), [6]);
    assert.equal(r.aiReading.scoresFrom, "工程 4");
    const md = renderRecord(r);
    const [facts, ai] = md.split(AI_READING_HEADING);
    assert.equal(facts.includes("- 判定（AI。本人の自己評価は記録に入れない）：まだ"), true);
    assert.equal(facts.includes("- 前回の面談：student-a-1"), true);
    assert.equal(facts.includes("行動：なし（この回の記録には、決めた行動が無い）"), true);
    assert.equal(ai.includes("追跡の判定のなぜ：発話 5 の直後に励ましへ移ったため。"), true);
    assert.equal(indexLine(r), "- records/student-a-2.md｜2 本目｜生徒｜相手 A｜よく表れた所（発話 2）・次に試せる所（発話 6）｜追跡：student-a-1 の行動 → まだ｜決めた行動：なし｜検証用・暫定");
  });

  test("表示を控えた文（性質の言葉が入っていた文）は記録に入れず、欄の名前を残す", () => {
    const input = baseInput();
    input.step1!.scenes[1].reading = WITHHELD_NOTICE;
    const r = buildFactRecord(input);
    assert.equal(r.aiReading.scenes[1].reading, "");
    assert.deepEqual(r.dropped.withheldFields, ["scenes[1].reading"]);
    assert.equal(renderRecord(r).includes(WITHHELD_NOTICE), false);
  });

  test("書く前の検査：AI が書いた文の性質の言葉を見つける。引用の中の言葉は数えない（決まり 3）", () => {
    const ok = buildFactRecord(baseInput());
    assert.equal(checkRecord(ok).ok, true);
    const input = baseInput();
    input.step1!.scenes[0].observation = "説明を重ねる傾向が見られた。";
    const hit = checkRecord(buildFactRecord(input));
    assert.equal(hit.ok, false);
    assert.deepEqual(hit.traitHits.map((h) => [h.word, h.field]), [["傾向", "scenes[0].observation"]]);
    // 発話の中に同じ言葉があっても数えない
    const spoken = utterances.map((u) => (u.index === 2 ? { ...u, text: "そういう性格なんだね。" } : u));
    const q: Quote = { citedText: blockText(spoken[2], 2), text: spoken[2].text as string, index: 2, endIndex: 3, verified: true };
    const input2 = baseInput({ utterances: spoken });
    input2.step1!.scenes[0].quotes = [q];
    assert.equal(checkRecord(buildFactRecord(input2)).ok, true);
    // 読みを外すと、読みの欄は検査しない
    const input3 = baseInput();
    input3.step1!.scenes[0].reading = "几帳面な人だと読める。";
    assert.equal(checkRecord(buildFactRecord(input3)).ok, false);
    assert.equal(checkRecord(buildFactRecord(input3), [], { includeAiReading: false }).ok, true);
  });

  test("書く前の検査：相手の名前は、引用の中でも見つける（決まり 12）", () => {
    const named = utterances.map((u) => (u.index === 3 ? { ...u, text: "たなかは数学が取れなくて。" } : u));
    const r = buildFactRecord(baseInput({ utterances: named }));
    const c = checkRecord(r, ["たなか"]);
    assert.equal(c.ok, false);
    assert.deepEqual(c.nameHits.map((h) => h.field), ["scenes[0].発話 3"]);
    assert.equal(checkRecord(r, []).ok, true);
  });

  test("読み返した文の検査：「>」の行（発話の本文）は性質の言葉を数えず、ほかの行は数える", () => {
    const md = ["# 記録", "- 観察：講師は様子を尋ねた。", "> 〔発話 2〕講師：そういうタイプなんだね。", ""].join("\n");
    assert.equal(checkMarkdown(md, "records/x.md").ok, true);
    assert.equal(withoutQuoteLines(md).includes("タイプ"), false);
    const bad = `${md}- まとめ：話しすぎる癖がある。\n`;
    assert.deepEqual(checkMarkdown(bad, "records/x.md").traitHits.map((h) => h.word).sort(), ["癖", "〜癖がある"].sort());
    assert.equal(checkMarkdown(md, "records/x.md", ["記録"]).nameHits.length, 1);
  });

  test("面談 ID とファイルの場所。ID は英小文字・数字・ハイフンだけ", () => {
    assert.equal(recordPath("student-shinro-2"), "/records/student-shinro-2.md");
    assert.throws(() => buildFactRecord(baseInput({ interviewId: "面談 1" })), /面談 ID/);
    assert.equal(quoteLineText({ index: 40, speaker: "講師", text: "そっか。" }), "> 〔発話 40〕講師：そっか。");
  });

  test("場面が無い面談は、無いと書く（決まり 4）", () => {
    const r = buildFactRecord(baseInput({ step1: { scenes: [], noScene: "根拠のある場面が見当たらない。" }, chosenAction: null }));
    const md = renderRecord(r);
    assert.equal(md.includes("- 場面：なし（根拠のある場面が見当たらない。）"), true);
    assert.equal(indexLine(r).includes("場面なし"), true);
  });
});
