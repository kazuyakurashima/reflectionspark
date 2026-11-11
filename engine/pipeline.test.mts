// API を呼ばずに、工程 0 → 1 → 2 の配線（呼び出しの形と、返事の受け取り）を偽のクライアントで確かめる。
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { setClientForTests } from "./claude.mts";
import { blockText } from "./citations.mts";
import { attachStep0c, runStep0, runStep0c } from "./step0.mts";
import { runStep1 } from "./step1.mts";
import { runStep2 } from "./step2.mts";

type Captured = { params: Record<string, unknown> };
const calls: Captured[] = [];

/** 返事を順番に返す偽のクライアント。messages.stream の形だけをまねる。 */
function fakeClient(responses: (() => unknown)[]) {
  let i = 0;
  return {
    messages: {
      stream(params: Record<string, unknown>) {
        calls.push({ params });
        const content = responses[i++]();
        const msg = { content, stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 10, output_tokens: 5 } };
        const s = {
          on() {
            return s;
          },
          finalMessage: async () => msg,
        };
        return s;
      },
    },
  };
}

const raw = "じゃあ始めようか。今日部活は。今日は早めに終わりました。古文の先生が出張で。そっか、吹奏楽来月が最後のコンクールだっけ。はい。引退です。";

describe("工程 0 → 1 → 2 の配線（偽のクライアント）", () => {
  test("0a の返事を元の文に当て直し、0b を当て、1 で引用を照合し、2 で点を受け取る", async () => {
    const text0a = JSON.stringify({
      utterances: [
        { speaker: "講師", text: "じゃあ、始めようか。今日、部活は？", confidence: "高", reason: "" },
        { speaker: "生徒", text: "今日は早めに終わりました。古文の先生が出張で。", confidence: "高", reason: "" },
        { speaker: "講師", text: "そっか、吹奏楽来月が最後のコンクールだっけ。", confidence: "高", reason: "" },
        { speaker: "生徒", text: "はい。引退です。", confidence: "中", reason: "" },
      ],
      multiple_others: false,
      multiple_others_reason: "",
    });
    const text0b = JSON.stringify({ corrections: [{ index: 1, kind: "同音の取り違え", before: "古文", after: "顧問" }] });
    const text0c = JSON.stringify({ summary: "進路の面談。", places: [{ index: 1, kind: "崩れ", fragment: "古文の先生", guess: "顧問の先生", clue: "部活の話" }] });
    // 工程 1 の返事：引用のブロックに citation が付く
    const quoteBlock = "〔発話 2〕講師：そっか、吹奏楽来月が最後のコンクールだっけ。";
    const step1Content = [
      { type: "text", text: '<scene type="よく表れた所">\n<items>1</items>\n<context>部活の話。</context>\n<quote>', citations: null },
      {
        type: "text",
        text: "そっか、吹奏楽来月が最後のコンクールだっけ。",
        citations: [{ type: "content_block_location", cited_text: quoteBlock, document_index: 0, document_title: "面談の文字起こし", start_block_index: 2, end_block_index: 3, file_id: null }],
      },
      {
        type: "text",
        text: "</quote>\n<observation>o</observation>\n<reaction>r</reaction>\n<reading>と読める。</reading>\n<question>q</question>\n<why_chosen>w</why_chosen>\n<runner_up>1</runner_up>\n</scene>\n<summary>s</summary>\n<flow>\na\nb\nc\n</flow>\n<extra_question></extra_question>",
        citations: null,
      },
    ];
    const step2Text = JSON.stringify({
      items: [1, 2, 3, 4].map((n) => ({ item: n, judged: true, score: 3, reason: "r", utterances: [2] })).concat([{ item: 5, judged: false, score: 0, reason: "初回", utterances: [] }]),
      insight_owner: "講師",
      ethics: { level: "問題なし", text: "問題なし", viewpoint: "", utterances: [] },
    });
    setClientForTests(
      fakeClient([
        () => [{ type: "text", text: text0a }],
        () => [{ type: "text", text: text0b }], // runStep0 は 0a → 0b。0c は runStep0c で別に送る
        () => [{ type: "text", text: text0c }],
        () => step1Content,
        () => [{ type: "text", text: step2Text }],
      ]),
    );
    calls.length = 0;
    const r0 = await runStep0(raw, "生徒");
    let t = r0.transcript;
    assert.equal(t.utterances.length, 4);
    assert.equal(t.utterances[1].original, "今日は早めに終わりました。古文の先生が出張で。");
    assert.equal(t.step0b.applied.length, 1);
    assert.equal(t.utterances[1].text, "今日は早めに終わりました。顧問の先生が出張で。");
    // 0c は工程 0 の中では回さない（分析を待たせない）。別に回して付ける
    assert.equal(t.step0c, null);
    assert.equal(calls.length, 2);
    const c = await runStep0c(t);
    t = attachStep0c(t, c.result, t.utterances.length);
    assert.equal(t.step0c?.guesses.length, 1);
    assert.equal(calls.length, 3);

    // 呼び出しの形：構造化出力は output_config.format を持ち、minimum が外れている
    const p0 = calls[0].params as { output_config: { format?: { schema: unknown } }; system: { text: string }[] };
    assert.ok(p0.output_config.format);
    assert.doesNotMatch(JSON.stringify(p0.output_config.format.schema), /minimum/);
    assert.match(p0.system[0].text, /言葉を変えない/);

    // 工程 1：document は 1 発話 1 ブロック、citations 有効、format 無し
    const fixedT = t;
    calls.length = 0;
    const r1 = await runStep1(fixedT);
    const p1 = calls[0].params as { output_config: { format?: unknown }; messages: { content: { type: string; source?: { type: string; content: { text: string }[] }; citations?: { enabled: boolean } }[] }[] };
    assert.equal(p1.output_config.format, undefined);
    const doc = p1.messages[0].content[0];
    assert.equal(doc.type, "document");
    assert.equal(doc.source?.type, "content");
    assert.equal(doc.source?.content.length, 4);
    assert.equal(doc.source?.content[2].text, blockText(fixedT.utterances[2]));
    // 各ブロックの先頭に発話番号の札がある（AI に発話を数えさせない）。札の番号は並びの位置
    assert.deepEqual(
      doc.source?.content.map((b) => b.text.slice(0, 6)),
      ["〔発話 0〕", "〔発話 1〕", "〔発話 2〕", "〔発話 3〕"],
    );
    const p1sys = (calls[0].params as { system: { text: string }[] }).system[0].text;
    assert.match(p1sys, /札の番号/);
    assert.match(p1sys, /自分で数え直しません/);
    assert.deepEqual(doc.citations, { enabled: true });
    assert.equal(r1.scenes.length, 1);
    assert.equal(r1.scenes[0].quotes.length, 1);
    assert.equal(r1.scenes[0].quotes[0].text, "そっか、吹奏楽来月が最後のコンクールだっけ。");
    assert.deepEqual(r1.quoteStats, { generated: 1, discarded: 0, scenesWithoutQuote: 0 });

    // 工程 2：自己採点は渡さない（user に「自己採点」の語が無い）。合計はアプリが計算
    calls.length = 0;
    const r2 = await runStep2(fixedT, r1.scenes);
    const p2 = calls[0].params as { messages: { content: string }[] };
    assert.doesNotMatch(p2.messages[0].content, /自己採点|自己評価/);
    assert.equal(r2.items[4].score, null);
    assert.deepEqual(r2.total, { sum: 12, judgedCount: 4, max: 20, scaled: 6 });
  });
});
