import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { blockText } from "./citations.mts";
import { buildFactRecord, checkMarkdown, recordPath, renderRecord, scanScoreWords } from "./memory-record.mts";
import type { FactRecordInput } from "./memory-record.mts";
import { buildRecordList, memoryConfig, parsePreviousRef, parseRecord, parseRecords, pastScenesText, readStep3Memory, resolvePreviousWords, withTimeout } from "./memory-read.mts";
import { STEP3_PAST_SCENES_SCHEMA, STEP3_SCHEMA, step3System, step3User } from "./prompts.mts";
import { buildLedgerEntry, ledgerPath, renderLedgerEntry } from "./score-ledger.mts";
import { candidatesOrMock, recordsOrOff } from "./server.mts";
import { attachPreviousWords, parseStep3 } from "./step3.mts";
import type { Candidate, Quote, Scene, Utterance } from "./types.mts";


const texts = ["今日は何から話そうか。", "もう嫌いになりそうです。", "嫌いになりそうか。", "前は割と好きだったんです。", "家ではどのくらいやってる。", "ほぼゼロです。", "大丈夫、これからだよ。", "……はい。"];
const utterances: Utterance[] = texts.map((t, i) => ({ index: i, speaker: i % 2 === 0 ? "講師" : "生徒", text: t, original: t, confidence: "高" as const, check: [], memoSpan: null }));
const quote = (index: number): Quote => ({ citedText: blockText(utterances[index], index), text: utterances[index].text as string, index, endIndex: index + 1, verified: true });
const scene = (over: Partial<Scene>): Scene => ({ type: "よく表れた所", items: [], context: "文脈。", quotes: [], discardedQuotes: [], quotedTextInBody: "", observation: "観察。", reaction: "反応。", reading: "読み。", asChoice: null, question: "問い。", record: { whyChosen: "", runnerUp: [] }, ...over });

const first: FactRecordInput = {
  interviewId: "student-b",
  date: "2025-10-24",
  kind: "生徒",
  order: 1,
  otherTag: "相手 B",
  followsInterviewId: null,
  status: "サンプル・暫定",
  utterances,
  step1: { scenes: [scene({ type: "よく表れた所", quotes: [quote(2)] }), scene({ type: "次に試せる所", quotes: [quote(6)] })], noScene: null },
  chosenAction: { sentence: "もし相手が短く答えたら、一つ聞き返す。", criterion: null, origin: "サンプルとして置いた" },
  followUp: null,
};
const second: FactRecordInput = {
  ...first,
  interviewId: "student-b-2",
  date: "2025-11-21",
  order: 2,
  followsInterviewId: "student-b",
  chosenAction: null,
  followUp: { previousInterviewId: "student-b", previousAction: "もし相手が短く答えたら、一つ聞き返す。", previousActionOrigin: "サンプルとして置いた", criterion: "聞き返しがある", quotes: [quote(4)], otherPersonLine: null },
};
const other: FactRecordInput = { ...first, interviewId: "student-c", date: "2025-10-28", order: 3, otherTag: "相手 C" };
const file = (input: FactRecordInput) => ({ id: input.interviewId, path: recordPath(input.interviewId, input.date), content: renderRecord(buildFactRecord(input)) });
const ledgerFile = (input: FactRecordInput, verdict: "できた" | null) => {
  const e = buildLedgerEntry({ interviewId: input.interviewId, date: input.date, self: { selfScore: 6, selfNote: "一言の文。", selfVerdict: verdict ? "一部" : null }, aiItems: [{ item: 1, score: 3 }], aiVerdict: verdict });
  return { id: `s-${input.interviewId}`, path: ledgerPath(e.interviewId, e.date), content: renderLedgerEntry(e) };
};

describe("記録を読む（engine/memory-read.mts）", () => {
  test("記録の文を読み、発話の本文は「>」の行からだけ取る。AI の文は読まない（決まり 1）", () => {
    const r = parseRecord(file(second).content);
    assert.ok(r);
    assert.equal(r.date, "2025-11-21");
    assert.equal(r.otherTag, "相手 B");
    assert.equal(r.followsInterviewId, "student-b");
    assert.deepEqual(r.scenes.map((s) => s.type), ["よく表れた所", "次に試せる所"]);
    assert.deepEqual(r.scenes[0].quotes, [{ index: 2, speaker: "講師", text: "嫌いになりそうか。" }]);
    assert.deepEqual(r.scenes[0].neighbors.map((l) => l.index), [1, 3]);
    assert.deepEqual(r.followUp?.quotes, [{ index: 4, speaker: "講師", text: "家ではどのくらいやってる。" }]);
    assert.equal(r.followUp?.previousAction, "もし相手が短く答えたら、一つ聞き返す。");
    assert.equal(r.followUp?.criterion, "聞き返しがある");
    assert.equal(r.action, null);
    assert.equal(JSON.stringify(r).includes("観察。"), false);
    assert.equal(JSON.stringify(r).includes("読み。"), false);
  });

  test("決めた行動と、基準が無い行動を読む。形の違う文は読まない", () => {
    const r = parseRecord(file(first).content);
    assert.deepEqual(r?.action, { sentence: "もし相手が短く答えたら、一つ聞き返す。", criterion: null, origin: "サンプルとして置いた" });
    assert.equal(r?.followUp, null);
    assert.equal(parseRecord("# 記録\n"), null);
    assert.equal(parseRecord(file(first).content.replace("record_format: 3", "record_format: 2")), null);
  });

  test("決まり 12：一覧は面談の日付の古い順。ストアの並びは使わない。同じ相手との回数を数える", () => {
    const list = buildRecordList([file(second), file(other), file(first), { id: "i", path: "/index.md", content: "# 索引\n" }], []);
    assert.deepEqual(list.map((e) => [e.date, e.interviewId, e.meetingWithOther]), [
      ["2025-10-24", "student-b", 1],
      ["2025-10-28", "student-c", 1],
      ["2025-11-21", "student-b-2", 2],
    ]);
    assert.deepEqual(list[0].strength?.quotes.map((l) => l.index), [2]);
    assert.deepEqual(list[0].nextTry?.quotes.map((l) => l.index), [6]);
    assert.equal(list[2].followUp?.previousAction, "もし相手が短く答えたら、一つ聞き返す。");
    assert.equal(list[0].scores, null);
  });

  test("決まり 10：点と判定は点の控えからだけ来て、記録の一覧の点の欄に入る", () => {
    const list = buildRecordList([file(first), file(second)], [ledgerFile(first, null), ledgerFile(second, "できた")]);
    assert.deepEqual(list[1].scores, { selfScore: 6, selfNote: "一言の文。", selfVerdict: "一部", aiItems: [{ item: 1, score: 3 }], aiTotal: { sum: 3, judgedCount: 1, max: 5, scaled: 6 }, aiVerdict: "できた" });
    assert.equal(list[0].scores?.aiVerdict, null);
    assert.equal(list[0].scores?.selfVerdict, null);
    // 記録の文には、点の控えの中身が入らない
    assert.equal(file(second).content.includes("一言の文。"), false);
    assert.deepEqual(scanScoreWords(file(second).content, "記録"), []);
  });
});

describe("前の言葉（画面 4）", () => {
  const records = parseRecords([file(first), file(second)]);

  test("決まり 1：札から記録の原文を引く。AI が書いた文は使わない。前後の発話も記録から", () => {
    const p = resolvePreviousWords("student-b｜発話 2", records);
    assert.deepEqual(p, {
      date: "2025-10-24",
      otherTag: "相手 B",
      before: { index: 1, speaker: "生徒", text: "もう嫌いになりそうです。" },
      own: { index: 2, speaker: "講師", text: "嫌いになりそうか。" },
      after: { index: 3, speaker: "生徒", text: "前は割と好きだったんです。" },
      interviewId: "student-b",
      utterance: 2,
    });
    assert.deepEqual(resolvePreviousWords("〔student-b｜発話 2〕", records), p);
  });

  test("決まり 1：札が記録に無ければ出さない。相手の発話の札も出さない", () => {
    assert.equal(resolvePreviousWords("student-x｜発話 2", records), null);
    assert.equal(resolvePreviousWords("student-b｜発話 0", records), null); // 記録に入っていない発話
    assert.equal(resolvePreviousWords("student-b｜発話 1", records), null); // 相手の発話
    assert.equal(resolvePreviousWords("", records), null);
    assert.equal(resolvePreviousWords(null, records), null);
    assert.equal(resolvePreviousWords("うまくいった発話", records), null);
    assert.equal(parsePreviousRef("student-b｜発話 2〜4"), null);
  });

  test("候補に添える：札を消し、合うものだけに前の言葉を付ける。見つからなければ今の見た目のまま", () => {
    const base: Candidate = { condition: "場面", action: "行動", sentence: "文", lines: ["セリフ"], criterion: "基準" };
    const out = attachPreviousWords([{ ...base, previousRef: "student-b｜発話 2" }, { ...base, previousRef: "student-x｜発話 2" }, base], records);
    assert.equal(out[0].previous?.own.text, "嫌いになりそうか。");
    assert.equal("previousRef" in out[0], false);
    assert.deepEqual(out[1], base);
    assert.deepEqual(out[2], base);
  });

  const recurring = `暫定（検証用の記録から作った。本人は確かめていない）
# 繰り返す場面

## 仮説 H1：相手が気持ちを口にした直後に、講師がその語で返す発話があった。
- 確からしさ：中
- 場面の形：相手が気持ちを口にした発話。
- 根拠：
    - 〔student-b｜発話 1〕生徒：「もう嫌いになりそうです。」
    - 〔student-b｜発話 2〕講師：「嫌いになりそうか。」
    - 説明：夢が書いた説明の文。
- 例外・反例：
    - 〔student-b｜発話 6〕講師：「大丈夫、これからだよ。」
- まだ分からないこと：夢が書いた分からないことの文。
`;

  test("工程 3 に渡す文：仮説・場面の形・根拠・反例だけ。確からしさと説明は渡さない", () => {
    const t = pastScenesText(recurring);
    assert.ok(t);
    assert.equal(t.includes("相手が気持ちを口にした直後"), true);
    assert.equal(t.includes("場面の形：相手が気持ちを口にした発話。"), true);
    assert.equal(t.includes("〔student-b｜発話 2〕講師：「嫌いになりそうか。」"), true);
    assert.equal(t.includes("〔student-b｜発話 6〕講師：「大丈夫、これからだよ。」"), true);
    assert.equal(t.includes("確からしさ"), false);
    assert.equal(t.includes("夢が書いた説明の文"), false);
    assert.equal(t.includes("分からないこと"), false);
  });

  test("決まり 10：夢の文に点か判定の言葉があれば、工程 3 に渡さない", () => {
    assert.equal(pastScenesText(recurring.replace("講師がその語で返す発話があった。", "講師がその語で返す発話があった（AI の判定と合う）。")), null);
    assert.equal(pastScenesText(recurring.replace("相手が気持ちを口にした発話。", "自己採点が低い回の発話。")), null);
  });

  test("決まり 3：夢の文に性質の言葉があれば、工程 3 に渡さない", () => {
    assert.equal(pastScenesText(recurring.replace("講師がその語で返す発話があった。", "説明しすぎる傾向があった。")), null);
  });

  test("仮説が読めなければ渡さない", () => {
    assert.equal(pastScenesText("# 繰り返す場面\n見当たらない。\n"), null);
  });

  test("読む材料：夢の出力か記録が読めなければ渡さない。点の控えのストアは読まない", async () => {
    const read: string[] = [];
    const client = (stores: Record<string, { path: string; content: string }[]>) => ({
      beta: {
        memoryStores: {
          memories: {
            list: async function* (storeId: string) {
              read.push(storeId);
              for (const f of stores[storeId] ?? []) yield { type: "memory", id: f.path, ...f };
            },
          },
        },
      },
    });
    const stores = { R: [file(first)], D: [{ path: "/recurring-scenes.md", content: recurring }], S: [ledgerFile(first, null)] };
    const m = await readStep3Memory(client(stores) as never, { recordsStoreId: "R", dreamStoreId: "D", scoresStoreId: "S" });
    assert.equal(m?.records.length, 1);
    assert.equal(m?.pastScenes.includes("嫌いになりそうか。"), true);
    assert.equal(read.includes("S"), false, "点の控えを読まない");
    assert.equal(await readStep3Memory(client({ R: [file(first)], D: [] }) as never, { recordsStoreId: "R", dreamStoreId: "D", scoresStoreId: null }), null);
    assert.equal(await readStep3Memory(client(stores) as never, { recordsStoreId: "R", dreamStoreId: null, scoresStoreId: null }), null);
  });
});

describe("旗（ストアの番号の環境変数）", () => {
  test("記録のストアの番号が無ければ旗なし", () => {
    assert.equal(memoryConfig({}), null);
    assert.equal(memoryConfig({ REFLECTIONSPARK_MEMORY_RECORDS_STORE: " " }), null);
    assert.deepEqual(memoryConfig({ REFLECTIONSPARK_MEMORY_RECORDS_STORE: "R" }), { recordsStoreId: "R", dreamStoreId: null, scoresStoreId: null });
    assert.deepEqual(memoryConfig({ REFLECTIONSPARK_MEMORY_RECORDS_STORE: "R", REFLECTIONSPARK_MEMORY_DREAM_STORE: "D", REFLECTIONSPARK_MEMORY_SCORES_STORE: "S" }), { recordsStoreId: "R", dreamStoreId: "D", scoresStoreId: "S" });
  });

  test("旗なしで、工程 3 に渡す文は今と一字も同じ（system・user・出力の形の指紋）", () => {
    const s = scene({ type: "次に試せる所", context: "文脈の一行。", quotes: [{ citedText: "x", text: "大丈夫。", index: 6, endIndex: 7, verified: true }], observation: "観察の文。", reaction: "反応の文。", reading: "読みの文。", asChoice: "選択の文。", question: "問いの文。" });
    const u = (index: number, speaker: string, text: string): Utterance => ({ index, speaker, text, original: text, confidence: "高", check: [], memoSpan: null });
    const text = JSON.stringify([step3System("生徒"), step3User(s, "聞き返す。", { before: u(5, "生徒", "ゼロです。"), after: u(7, "生徒", "はい。") }), STEP3_SCHEMA]);
    // main の engine/prompts.mts（記録をつなぐ前）で同じ入力から計算した値
    assert.equal(crypto.createHash("sha256").update(text).digest("hex"), "c483527981559672db3d4c6eef4ec23524ec1fdf6da9128190c153c98c6cea0d");
  });

  test("記録を渡すときだけ、決まりの文と札の欄が足される。出すための指示は入れない", () => {
    const s = scene({ type: "次に試せる所" });
    const none = { before: null, after: null };
    assert.equal(step3System("生徒", true).includes("previous_ref"), true);
    assert.equal(step3System("生徒", true).includes("合う発話が無ければ空にする"), true);
    assert.equal(step3System("生徒").includes("previous_ref"), false);
    assert.equal(step3User(s, "答え", none, "仮説の文").includes("前の面談の記録から"), true);
    assert.equal(step3User(s, "答え", none).includes("前の面談の記録から"), false);
    assert.equal("previous_ref" in STEP3_PAST_SCENES_SCHEMA.properties.candidates.items.properties, true);
    assert.equal("previous_ref" in STEP3_SCHEMA.properties.candidates.items.properties, false);
    // 札は候補に持ち越す。無ければ欄を足さない
    const raw = { condition: "場面", action: "聞き返す", lines: ["セリフ"], criterion: "基準" };
    assert.equal(parseStep3({ candidates: [{ ...raw, previous_ref: "a｜発話 1" }] }).candidates[0].previousRef, "a｜発話 1");
    assert.equal("previousRef" in parseStep3({ candidates: [{ ...raw, previous_ref: "" }] }).candidates[0], false);
  });

  test("鍵が無いとき：記録の一覧は旗なしで返し、候補は記録なしで返す", async () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, store: process.env.REFLECTIONSPARK_MEMORY_RECORDS_STORE };
    delete process.env.ANTHROPIC_API_KEY;
    process.env.REFLECTIONSPARK_MEMORY_RECORDS_STORE = "R";
    try {
      assert.deepEqual(await recordsOrOff(), { enabled: false });
      const r = await candidatesOrMock({ kind: "生徒", utterances, raw: "" } as never, scene({ type: "次に試せる所", quotes: [quote(6)] }), "答え", { demo: true });
      assert.equal(r.memory, "off");
      assert.equal(r.step3.candidates.every((c) => !c.previous), true);
    } finally {
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.store === undefined) delete process.env.REFLECTIONSPARK_MEMORY_RECORDS_STORE;
      else process.env.REFLECTIONSPARK_MEMORY_RECORDS_STORE = saved.store;
    }
  });

  test("読み出しに時間の上限を付ける", async () => {
    assert.equal(await withTimeout(Promise.resolve(1), 50), 1);
    await assert.rejects(withTimeout(new Promise(() => {}), 5), /時間切れ/);
  });
});

// 実際に作った記録と夢の出力（eval/results/memory/）を確かめる。サンプルの過去 4 回だけ
describe("サンプルの記録と夢の出力（実データ）", () => {
  const dir = "eval/results/memory/2026-11-06T16-55-09";
  const read = (sub: string) =>
    fs
      .readdirSync(path.join(dir, sub))
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ id: f, path: `/${sub}/${f}`, content: fs.readFileSync(path.join(dir, sub, f), "utf8") }));
  const recordFiles = read("records");
  const dreamFiles = read("dream");

  test("過去 4 回だけが記録にある。山場の 2 回は入っていない", () => {
    assert.deepEqual(parseRecords(recordFiles).map((r) => r.interviewId).sort(), ["student-seiseki", "student-seiseki-2", "student-yaruki", "student-yaruki-2"]);
    assert.equal([...recordFiles, ...dreamFiles].some((f) => /2026-0[67]-|student-shinro/.test(f.path + f.content)), false);
  });

  test("決まり 10：記録と夢の出力に、点の数字と判定の言葉が無い", () => {
    for (const f of [...recordFiles, ...dreamFiles]) assert.deepEqual(scanScoreWords(f.content, f.path), [], f.path);
  });

  test("決まり 3：記録と夢の出力に、性質の言葉が 0 件", () => {
    for (const f of [...recordFiles, ...dreamFiles]) assert.deepEqual(checkMarkdown(f.content, f.path).traitHits, [], f.path);
  });

  test("決まり 1：夢の根拠にある本人の発話の札は、すべて記録の原文を引ける。引いた文は分析の発話と一致する", () => {
    const records = parseRecords(recordFiles);
    const text = pastScenesText(dreamFiles.find((f) => f.path.endsWith("recurring-scenes.md"))!.content);
    assert.ok(text);
    const lines = [...text.matchAll(/〔([^〕]+)〕講師：「(.*)」$/gm)];
    assert.ok(lines.length > 0);
    for (const [, ref, written] of lines) {
      const p = resolvePreviousWords(ref, records);
      assert.ok(p, ref);
      assert.equal(p.own.text, written, ref);
    }
  });

  test("決まり 12：一覧は面談の日付の古い順で、続きの回に前回の行動と現れた発言がある", () => {
    const list = buildRecordList(recordFiles, []);
    assert.deepEqual(list.map((e) => e.date), ["2025-10-24", "2025-10-28", "2025-11-18", "2025-11-21"]);
    assert.deepEqual(list.map((e) => e.meetingWithOther), [1, 1, 2, 2]);
    assert.equal(list[2].followUp?.previousInterviewId, "student-yaruki");
    assert.equal(list[3].followUp?.previousInterviewId, "student-seiseki");
    assert.ok(list[3].followUp?.quotes.length);
  });
});
