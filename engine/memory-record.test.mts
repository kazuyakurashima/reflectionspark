import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { blockText } from "./citations.mts";
import { WITHHELD_NOTICE } from "./guard.mts";
import { ACTION_HEADING, AI_READING_HEADING, AI_WRITTEN_HEADING, applyCorrection, assertNoSelfEvaluation, buildFactRecord, checkMarkdown, checkRecord, FOLLOW_UP_HEADING, indexLine, nameCheckLabel, ORIGINAL_HEADING, quoteLineText, recordPath, renderRecord, scanScoreWords, withoutQuoteLines } from "./memory-record.mts";
import type { FactRecordInput } from "./memory-record.mts";
import type { Quote, Scene, Utterance } from "./types.mts";

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

const baseInput = (over: Partial<FactRecordInput> = {}): FactRecordInput => ({
  interviewId: "student-a-1",
  date: "2025-10-24",
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

  test("見出しを出所で分ける：原文の欄には発話の本文だけ、AI の文は AI の欄に入る", () => {
    const r = buildFactRecord(baseInput());
    const md = renderRecord(r);
    const [head, afterOriginal] = md.split(ORIGINAL_HEADING);
    assert.equal(head.includes("record_format: 3"), true);
    assert.equal(head.includes("date: 2025-10-24"), true);
    const [original, afterAction] = afterOriginal.split(ACTION_HEADING);
    const [action, afterAiWritten] = afterAction.split(AI_WRITTEN_HEADING);
    const [aiWritten, reading] = afterAiWritten.split(AI_READING_HEADING);
    // 原文の欄：「>」の行のほかに、AI の文（文脈・観察・反応・読み）が入らない
    assert.equal(original.includes(`> 〔発話 2〕講師：${texts[2]}`), true);
    for (const aiText of ["模試の判定の話。", "発話 1 の直後、講師は判定を見たときの様子を尋ねた。", "発話 3 で生徒は数学のことを続けた。", "受け止めを先に聞いたと読める。"]) assert.equal(original.includes(aiText), false, aiText);
    // 行動の欄：決まり方を添える
    assert.equal(action.includes("行動：もし相手が今の過ごし方を話したら、励ます前に一つ聞き返す。"), true);
    assert.equal(action.includes("決まり方：検証用に置いた"), true);
    // AI の欄：照合していないと断り、文脈・観察・反応が入る
    assert.equal(AI_WRITTEN_HEADING.includes("原文と照合していない"), true);
    assert.equal(aiWritten.includes("場面 1 の文脈：模試の判定の話。"), true);
    assert.equal(aiWritten.includes("場面 1 の観察：発話 1 の直後、講師は判定を見たときの様子を尋ねた。"), true);
    assert.equal(aiWritten.includes("場面 1 の直後の相手の反応：発話 3 で生徒は数学のことを続けた。"), true);
    assert.equal(reading.includes("場面 1 の読み：受け止めを先に聞いたと読める。"), true);
  });

  test("読みは「その回の AI の読み（仮説）」に分けて書き、読みごと外せる", () => {
    const r = buildFactRecord(baseInput());
    const md = renderRecord(r);
    const [before, ai] = md.split(AI_READING_HEADING);
    assert.equal(before.includes("受け止めを先に聞いたと読める。"), false);
    assert.equal(ai.includes("場面 2 を意図した選択として見ると："), true);
    const noReading = renderRecord(r, { includeAiReading: false });
    assert.equal(noReading.includes(AI_READING_HEADING), false);
    assert.equal(noReading.includes("と読める"), false);
    assert.equal(noReading.includes("場面 1 の観察：発話 1 の直後、講師は判定を見たときの様子を尋ねた。"), true);
  });

  const followUpInput = (): FactRecordInput =>
    baseInput({
        interviewId: "student-a-2",
        date: "2025-11-21",
        order: 2,
        followsInterviewId: "student-a-1",
        chosenAction: null,
        followUp: {
          previousInterviewId: "student-a-1",
          previousAction: "もし相手が今の過ごし方を話したら、励ます前に一つ聞き返す。",
          previousActionOrigin: "検証用に置いた",
          criterion: null,
          quotes: [quote(6)],
          otherPersonLine: null,
        },
    });

  test("続きの面談：次の回に現れた発言は原文の欄、前回の行動は決まり方つきで行動の欄に入る。索引の行に日付が入る", () => {
    const r = buildFactRecord(followUpInput());
    assert.deepEqual(r.followUp?.quotes.map((l) => l.index), [6]);
    const md = renderRecord(r);
    const [original, afterAction] = md.split(AI_READING_HEADING)[0].split(ACTION_HEADING);
    const [action] = afterAction.split(AI_WRITTEN_HEADING);
    assert.equal(original.includes(FOLLOW_UP_HEADING), true);
    assert.equal(original.includes(`> 〔発話 6〕講師：${texts[6]}`), true);
    assert.equal(action.includes("- 前回の面談：student-a-1"), true);
    assert.equal(action.includes("- 決まり方：検証用に置いた"), true);
    assert.equal(action.includes("行動：なし（この回の記録には、決めた行動が無い）"), true);
    assert.equal(indexLine(r), "- records/2025-11-21-student-a-2.md｜2025-11-21｜2 本目｜生徒｜相手 A｜よく表れた所（発話 2）・次に試せる所（発話 6）｜追跡：student-a-1 の行動｜決めた行動：なし｜検証用・暫定");
  });

  test("決まり 10：点・判定・判定のなぜは、記録の入力に渡せない。記録の型にも欄が無い", () => {
    const withVerdict = followUpInput();
    assert.throws(() => buildFactRecord({ ...withVerdict, followUp: { ...withVerdict.followUp!, verdict: "まだ" } } as unknown as FactRecordInput), /記録係に渡せない欄/);
    assert.throws(() => buildFactRecord({ ...withVerdict, followUp: { ...withVerdict.followUp!, why: "理由" } } as unknown as FactRecordInput), /記録係に渡せない欄/);
    assert.throws(() => buildFactRecord({ ...baseInput(), step2: { items: [] } } as unknown as FactRecordInput), /記録係に渡せない欄/);
    assert.throws(() => buildFactRecord({ ...baseInput(), scores: [] } as unknown as FactRecordInput), /記録係に渡せない欄/);
    const r = buildFactRecord(withVerdict) as unknown as Record<string, unknown>;
    assert.equal("verdict" in (r.followUp as object), false);
    assert.equal("scores" in (r.aiReading as object), false);
    assert.equal("followUpWhy" in (r.aiReading as object), false);
  });

  test("決まり 10：できた記録の文と索引の 1 行に、点の数字と判定の言葉が入らない", () => {
    const input = followUpInput();
    input.step1!.scenes[0].context = "家での勉強の話。";
    input.step1!.scenes[0].observation = "発話 1 の直後、講師は様子を尋ねた。";
    const r = buildFactRecord(input);
    const md = renderRecord(r);
    assert.deepEqual(scanScoreWords(md, "記録"), []);
    assert.deepEqual(scanScoreWords(indexLine(r), "索引"), []);
    assert.equal(checkMarkdown(md, "記録").ok, true);
  });

  test("決まり 10：点と判定の言葉を見つける。発話の本文の行と「」の中、ふつうの文の「できた日」「まだ」、模試の判定は数えない", () => {
    const words = (s: string) => scanScoreWords(s, "x").map((h) => h.word);
    assert.deepEqual(words("- 追跡の判定（AI）：まだ"), ["判定", "判定の言葉（欄の値）"]);
    assert.deepEqual(words("- 面談の点（工程 2。人の点ではない）：項目 1＝4、項目 2＝判定しない"), ["判定", "項目ごとの点", "項目ごとの点", "面談の点"]);
    assert.deepEqual(words("| 決めた面談 | 行動 | 一部 |"), ["判定の言葉（欄の値）"]);
    assert.deepEqual(words("合計は 7／10。"), ["点の形"]);
    assert.deepEqual(words("自己採点は使わない。"), ["面談の点"]);
    assert.deepEqual(words("> 〔発話 2〕講師：判定はまだだよ。自己評価は 7/10 だね。"), []);
    assert.deepEqual(words("相手が「判定、できた」と言った。"), []);
    assert.deepEqual(words("できた日の様子を尋ねた。まだ分からないこと：なし。数学が 51 点に下がった。"), []);
    assert.deepEqual(words("模試は D 判定だった。模試の判定の話。"), []);
    // 検査は、読み返しの検査の「通らない」にもなる
    assert.equal(checkMarkdown("- 追跡の判定：できた\n", "x").ok, false);
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
    const clean = () => {
      const i = baseInput();
      i.step1!.scenes[0].context = "受け止めの話。";
      i.step1!.scenes[0].observation = "発話 1 の直後、講師は様子を尋ねた。";
      return i;
    };
    assert.equal(checkRecord(buildFactRecord(clean())).ok, true);
    const input = clean();
    input.step1!.scenes[0].observation = "説明を重ねる傾向が見られた。";
    const hit = checkRecord(buildFactRecord(input));
    assert.equal(hit.ok, false);
    assert.deepEqual(hit.traitHits.map((h) => [h.word, h.field]), [["傾向", "scenes[0].observation"]]);
    // 発話の中に同じ言葉があっても数えない
    const spoken = utterances.map((u) => (u.index === 2 ? { ...u, text: "そういう性格なんだね。" } : u));
    const q: Quote = { citedText: blockText(spoken[2], 2), text: spoken[2].text as string, index: 2, endIndex: 3, verified: true };
    const input2 = { ...clean(), utterances: spoken };
    input2.step1!.scenes[0].quotes = [q];
    assert.equal(checkRecord(buildFactRecord(input2)).ok, true);
    // 読みを外すと、読みの欄は検査しない
    const input3 = clean();
    input3.step1!.scenes[0].reading = "几帳面な人だと読める。";
    assert.equal(checkRecord(buildFactRecord(input3)).ok, false);
    assert.equal(checkRecord(buildFactRecord(input3), [], { includeAiReading: false }).ok, true);
  });

  test("書く前の検査：相手の名前は、引用の中でも見つける（決まり 12）", () => {
    const named = utterances.map((u) => (u.index === 3 ? { ...u, text: "たなかは数学が取れなくて。" } : u));
    const r = buildFactRecord(baseInput({ utterances: named }));
    const c = checkRecord(r, ["たなか"]);
    assert.equal(c.nameHits.length > 0, true);
    assert.equal(c.ok, false);
    assert.deepEqual(c.nameHits.map((h) => h.field), ["scenes[0].発話 3"]);
    assert.equal(c.nameListSize, 1);
    // 一覧を渡さなければ、名前があっても見つからない。これを「0 件」と書かない
    const unchecked = checkRecord(r, []);
    assert.equal(unchecked.nameHits.length, 0);
    assert.equal(unchecked.nameListSize, 0);
    assert.equal(nameCheckLabel(unchecked.nameListSize, unchecked.nameHits.length).startsWith("未検査"), true);
    assert.equal(nameCheckLabel(1, 1), "1 件（一覧の 1 件と照らした。一覧に無い名前は見つけられない）");
  });

  test("本人の訂正：直す文がちょうど 1 か所のときだけ当て、発話の本文は直さない", () => {
    const md = renderRecord(buildFactRecord(baseInput()));
    const fixed = applyCorrection(md, { oldText: "発話 1 の直後、講師は判定を見たときの様子を尋ねた。", newText: "発話 1 の直後、講師は判定の受け止めを尋ねた。" });
    assert.equal(fixed.includes("判定の受け止めを尋ねた。"), true);
    assert.equal(fixed.includes("判定を見たときの様子を尋ねた。"), false);
    assert.equal(fixed.includes("corrected: 本人が直した"), true);
    // 2 回目の訂正でも、印は 1 つ
    const twice = applyCorrection(fixed, { oldText: "発話 3 で生徒は数学のことを続けた。", newText: "発話 3 で生徒は数学の話を続けた。" });
    assert.equal(twice.split("corrected:").length - 1, 1);
    assert.throws(() => applyCorrection(md, { oldText: texts[2], newText: "別の文" }), /発話の本文/);
    assert.throws(() => applyCorrection(md, { oldText: "無い文", newText: "別の文" }), /0 か所/);
    assert.throws(() => applyCorrection(md, { oldText: "場面", newText: "別の文" }), /か所/);
    assert.throws(() => applyCorrection(md, { oldText: "", newText: "別の文" }), /入れてください/);
  });

  test("読み返した文の検査：「>」の行（発話の本文）は性質の言葉を数えず、ほかの行は数える", () => {
    const md = ["# 記録", "- 観察：講師は様子を尋ねた。", "> 〔発話 2〕講師：そういうタイプなんだね。", ""].join("\n");
    assert.equal(checkMarkdown(md, "records/x.md").ok, true);
    assert.equal(withoutQuoteLines(md).includes("タイプ"), false);
    const bad = `${md}- まとめ：話しすぎる癖がある。\n`;
    assert.deepEqual(checkMarkdown(bad, "records/x.md").traitHits.map((h) => h.word).sort(), ["癖", "〜癖がある"].sort());
    assert.equal(checkMarkdown(md, "records/x.md", ["記録"]).nameHits.length, 1);
  });

  test("決まり 12：面談の日付を頭の欄とファイル名に入れる。面談 ID は英小文字・数字・ハイフンだけ", () => {
    assert.equal(recordPath("student-a-2", "2025-11-21"), "/records/2025-11-21-student-a-2.md");
    assert.throws(() => buildFactRecord(baseInput({ interviewId: "面談 1" })), /面談 ID/);
    assert.throws(() => buildFactRecord(baseInput({ date: "11 月 21 日" })), /面談の日付/);
    assert.equal(quoteLineText({ index: 40, speaker: "講師", text: "そっか。" }), "> 〔発話 40〕講師：そっか。");
  });

  test("場面が無い面談は、無いと書く（決まり 4）", () => {
    const r = buildFactRecord(baseInput({ step1: { scenes: [], noScene: "根拠のある場面が見当たらない。" }, chosenAction: null }));
    const md = renderRecord(r);
    assert.equal(md.includes("- 場面：なし"), true);
    assert.equal(md.includes("- 場面が無い理由：根拠のある場面が見当たらない。"), true);
    assert.equal(indexLine(r).includes("場面なし"), true);
  });
});
