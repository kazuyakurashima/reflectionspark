// 工程 0a の速い作り方（label）：アプリが文に切り、モデルは番号ごとの話者だけを返す。
// 当て直しと分け方を偽のクライアントで守る（話者の切り替わり、一文の中での切り替わり、短い相づちが続く所、区切りが分からない所）。
// 環境変数の既定（REFLECTIONSPARK_STEP0_MODE・_MODEL・_EFFORT）は、読み込みの前に入れて確かめる。
process.env.REFLECTIONSPARK_STEP0_MODE = "label";
process.env.REFLECTIONSPARK_STEP0_MODEL = "test-step0-model";
process.env.REFLECTIONSPARK_STEP0_EFFORT = "low";

import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { setClientForTests, STEP0_EFFORT, STEP0_MODEL, parseEffort } = await import("./claude.mts");
const { CHECK_LOW_CONFIDENCE, CHECK_MULTIPLE_OTHERS, CHECK_SPEAKER_LABEL, CHECK_UNANCHORED, STEP0A_MODE, findSplitAt, labelUtterances, parseStep0aMode, runStep0, runStep0a, splitSentences } =
  await import("./step0.mts");
type Step0aLabelRaw = import("./types.mts").Step0aLabelRaw;

const raw = "じゃあ始めようか。今日部活は。今日は早めに終わりました。顧問の先生が出張で。そっか、吹奏楽来月が最後のコンクールだっけ。はいあ、ごめん会場はどこ市民会館です。";

function parsed(p: Partial<Step0aLabelRaw>): Step0aLabelRaw {
  return { sentences: [], reasons: [], splits: [], multipleOthers: false, ...p };
}
const lab = (n: number, speaker: string, confidence: "高" | "中" | "低" = "高") => ({ n, speaker, confidence });

describe("0a（label）：文の切り方", () => {
  test("文の終わりで切り、位置と本文は元の文字起こしの切り出し。閉じ括弧は前の文に含め、空白だけの所は文にしない", () => {
    const text = "はい。「分かった」と言ってました！ そうなんだ？\n\nうん、それで。終わり";
    const s = splitSentences(text);
    assert.deepEqual(
      s.map((x) => x.text),
      ["はい。", "「分かった」と言ってました！", "そうなんだ？", "うん、それで。", "終わり"],
    );
    const cps = [...text];
    for (const x of s) assert.equal(cps.slice(x.start, x.end).join(""), x.text);
    assert.deepEqual(
      s.map((x) => x.n),
      [0, 1, 2, 3, 4],
    );
    // すべての空白でない文字がどれかの文に入る
    assert.equal(s.map((x) => x.text).join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  });

  test("句読点の無い長い文は読点や空白でさらに切る。短い文はそのまま", () => {
    const long = "あのですね、" + "それでですね、".repeat(12) + "はい";
    const s = splitSentences(long);
    assert.ok(s.length >= 2, `文の数 ${s.length}`);
    assert.equal(s.map((x) => x.text).join(""), long);
    assert.ok(s.every((x) => [...x.text].length <= 80));
    assert.equal(splitSentences("はい。").length, 1);
  });

  test("区切りの文字列の位置：そのまま → 句読点の違いをゆるく → 無ければ null。短すぎる文字列はゆるく探さない", () => {
    assert.equal(findSplitAt("はいあ、ごめん会場はどこ", "あ、ごめん"), 2);
    assert.equal(findSplitAt("はいあ、ごめん会場はどこ", "あごめん"), 2);
    assert.equal(findSplitAt("はいあ、ごめん会場はどこ", "まったく別"), null);
    assert.equal(findSplitAt("はいあ、ごめん会場はどこ", "は"), 0);
    assert.equal(findSplitAt("はいあ、ごめん会場はどこ", "よ"), null);
    assert.equal(findSplitAt("はい", ""), null);
  });
});

describe("0a（label）：当て直しと分け方（言葉を変えない）", () => {
  const sentences = () => splitSentences(raw);

  test("話者の切り替わりで発話を区切り、同じ話者が続く文は 1 つの発話にまとめる。本文は元の文字起こしの切り出し", () => {
    const { utterances, unanchored } = labelUtterances(
      raw,
      sentences(),
      parsed({
        sentences: [lab(0, "講師"), lab(1, "講師"), lab(2, "生徒"), lab(3, "生徒", "中"), lab(4, "講師"), lab(5, "生徒")],
      }),
      "生徒",
    );
    assert.equal(unanchored, 0);
    assert.deepEqual(
      utterances.map((u) => [u.speaker, u.original]),
      [
        ["講師", "じゃあ始めようか。今日部活は。"],
        ["生徒", "今日は早めに終わりました。顧問の先生が出張で。"],
        ["講師", "そっか、吹奏楽来月が最後のコンクールだっけ。"],
        ["生徒", "はいあ、ごめん会場はどこ市民会館です。"],
      ],
    );
    // まとめた発話の確からしさは低い方（中）。番号と位置が付く
    assert.equal(utterances[1].confidence, "中");
    assert.deepEqual(
      utterances.map((u) => u.index),
      [0, 1, 2, 3],
    );
    assert.deepEqual(utterances[0].memoSpan, [0, [..."じゃあ始めようか。今日部活は。"].length]);
    assert.equal(utterances.map((u) => u.original).join(""), raw);
    assert.ok(utterances.every((u) => u.text === u.original));
  });

  test("一文の中で話者が替わる所（はいあ、ごめん）は、モデルが返した短い文字列の位置で分ける。言葉は変えない", () => {
    const { utterances, unanchored } = labelUtterances(
      raw,
      sentences(),
      parsed({
        sentences: [lab(0, "講師"), lab(1, "講師"), lab(2, "生徒"), lab(3, "生徒"), lab(4, "講師"), lab(5, "生徒", "中")],
        splits: [
          { n: 5, at: "あ、ごめん", speaker: "講師", confidence: "低", reason: "二人の言葉がくっついている" },
          { n: 5, at: "市民会館", speaker: "生徒", confidence: "高", reason: "" },
        ],
      }),
      "生徒",
    );
    assert.equal(unanchored, 0);
    assert.deepEqual(
      utterances.slice(3).map((u) => [u.speaker, u.original, u.confidence]),
      [
        ["生徒", "はい", "中"],
        ["講師", "あ、ごめん会場はどこ", "低"],
        ["生徒", "市民会館です。", "高"],
      ],
    );
    assert.deepEqual(utterances[4].check, [CHECK_LOW_CONFIDENCE]);
    assert.equal(utterances[4].confidenceReason, "二人の言葉がくっついている");
    assert.equal(utterances.map((u) => u.original).join(""), raw);
  });

  test("区切りの文字列が文の先頭なら、その文の話者を後の話者にする（空の発話を作らない）。順番が前後していても位置の順に分ける", () => {
    const { utterances } = labelUtterances(
      "はい。会場はどこ市民会館です。",
      splitSentences("はい。会場はどこ市民会館です。"),
      parsed({
        sentences: [lab(0, "生徒"), lab(1, "生徒")],
        splits: [
          { n: 1, at: "市民会館", speaker: "生徒", confidence: "高", reason: "" },
          { n: 1, at: "会場はどこ", speaker: "講師", confidence: "高", reason: "" },
        ],
      }),
      "生徒",
    );
    assert.deepEqual(
      utterances.map((u) => [u.speaker, u.original]),
      [
        ["生徒", "はい。"],
        ["講師", "会場はどこ"],
        ["生徒", "市民会館です。"],
      ],
    );
  });

  test("短い相づちが続く所は、話者が替わるたびに別の発話になる", () => {
    const text = "部活がきつくて。うん。朝練もあって。うん。それで。そっか。";
    const { utterances } = labelUtterances(
      text,
      splitSentences(text),
      parsed({ sentences: [lab(0, "生徒"), lab(1, "講師"), lab(2, "生徒"), lab(3, "講師"), lab(4, "生徒"), lab(5, "講師")] }),
      "生徒",
    );
    assert.deepEqual(
      utterances.map((u) => [u.speaker, u.original]),
      [
        ["生徒", "部活がきつくて。"],
        ["講師", "うん。"],
        ["生徒", "朝練もあって。"],
        ["講師", "うん。"],
        ["生徒", "それで。"],
        ["講師", "そっか。"],
      ],
    );
    assert.ok(utterances.every((u) => u.check.length === 0));
  });

  test("区切りが分からない所：モデルの返事に無い文と、区切りの文字列が文に無い文は、まとめずに 1 つの発話にして印を付ける（本人が画面 1 で分ける）", () => {
    const { utterances, unanchored } = labelUtterances(
      raw,
      sentences(),
      parsed({
        // 文 1 と文 3 が返事に無い。文 5 の区切りが文に無い
        sentences: [lab(0, "講師"), lab(2, "生徒"), lab(4, "講師"), lab(5, "生徒")],
        splits: [{ n: 5, at: "まったく別の言葉", speaker: "講師", confidence: "低", reason: "" }],
      }),
      "生徒",
    );
    assert.equal(unanchored, 3);
    assert.deepEqual(
      utterances.map((u) => [u.speaker, u.original, u.confidence]),
      [
        ["講師", "じゃあ始めようか。", "高"],
        ["講師", "今日部活は。", "低"],
        ["生徒", "今日は早めに終わりました。", "高"],
        ["生徒", "顧問の先生が出張で。", "低"],
        ["講師", "そっか、吹奏楽来月が最後のコンクールだっけ。", "高"],
        ["生徒", "はいあ、ごめん会場はどこ市民会館です。", "低"],
      ],
    );
    assert.ok(utterances[1].check.some((c) => c.startsWith(CHECK_UNANCHORED) && c.includes("文 1")));
    assert.ok(utterances[3].check.some((c) => c.startsWith(CHECK_UNANCHORED) && c.includes("文 3")));
    assert.ok(utterances[5].check.some((c) => c.startsWith(CHECK_UNANCHORED) && c.includes("まったく別の言葉")));
    assert.ok(utterances[5].check.includes(CHECK_LOW_CONFIDENCE));
    // 前の発話にくっつけない
    assert.equal(utterances[0].original, "じゃあ始めようか。");
    assert.equal(utterances.map((u) => u.original).join(""), raw);
  });

  test("確からしさが低い文はまとめず、理由を付ける。相手が 2 人以上のときはすべての発話に印。読めない話者ラベルは相手に寄せて印", () => {
    const { utterances } = labelUtterances(
      raw,
      sentences(),
      parsed({
        sentences: [lab(0, "講師"), lab(1, "講師", "低"), lab(2, "生徒"), lab(3, "生徒"), lab(4, "先生"), lab(5, "生徒")],
        reasons: [{ n: 1, reason: "問いの形だが相手の言葉にも読める" }],
        multipleOthers: true,
        multipleOthersReason: "保護者らしい声がある",
      }),
      "生徒",
    );
    assert.deepEqual(
      utterances.map((u) => [u.speaker, u.original]),
      [
        ["講師", "じゃあ始めようか。"],
        ["講師", "今日部活は。"],
        ["生徒", "今日は早めに終わりました。顧問の先生が出張で。"],
        ["生徒", "そっか、吹奏楽来月が最後のコンクールだっけ。"],
        ["生徒", "はいあ、ごめん会場はどこ市民会館です。"],
      ],
    );
    assert.equal(utterances[1].confidence, "低");
    assert.equal(utterances[1].confidenceReason, "問いの形だが相手の言葉にも読める");
    assert.deepEqual(utterances[1].check, [CHECK_LOW_CONFIDENCE, CHECK_MULTIPLE_OTHERS]);
    assert.ok(utterances[3].check.includes(CHECK_SPEAKER_LABEL));
    assert.ok(utterances.every((u) => u.check.includes(CHECK_MULTIPLE_OTHERS)));
  });

  test("同じ番号が 2 回返っても最初のものを使い、範囲の外の番号は無視する。文が無ければ投げる", () => {
    const { utterances, unanchored } = labelUtterances(
      "はい。そう。",
      splitSentences("はい。そう。"),
      parsed({ sentences: [lab(0, "生徒"), lab(0, "講師"), lab(1, "講師"), lab(9, "講師")] }),
      "生徒",
    );
    assert.equal(unanchored, 0);
    assert.deepEqual(
      utterances.map((u) => u.speaker),
      ["生徒", "講師"],
    );
    assert.throws(() => labelUtterances("", [], parsed({}), "生徒"), /文がありません/);
  });
});

describe("0a の作り方・モデル・考える量の切り替え（偽のクライアント）", () => {
  type Captured = { params: Record<string, unknown> };
  const calls: Captured[] = [];
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
  const labelText = JSON.stringify({
    sentences: [lab(0, "講師"), lab(1, "講師"), lab(2, "生徒"), lab(3, "生徒"), lab(4, "講師"), lab(5, "生徒")],
    reasons: [],
    splits: [{ n: 5, at: "あ、ごめん", speaker: "講師", confidence: "低", reason: "二人の言葉がくっついている" }],
    multiple_others: false,
    multiple_others_reason: "",
  });

  test("環境変数の既定：作り方 label、モデルと考える量。読めない値は投げる", () => {
    assert.equal(STEP0A_MODE, "label");
    assert.equal(STEP0_MODEL, "test-step0-model");
    assert.equal(STEP0_EFFORT, "low");
    assert.equal(parseStep0aMode(undefined), null);
    assert.equal(parseStep0aMode("copy"), "copy");
    assert.throws(() => parseStep0aMode("fast"), /copy か label/);
    assert.equal(parseEffort(""), null);
    assert.throws(() => parseEffort("mid"), /考える量/);
  });

  test("label：文に番号を付けて渡し、label の形で受け、モデルと考える量が呼び出しに入る。返事の本文は使わず、元の文字起こしから切り出す", async () => {
    setClientForTests(fakeClient([() => [{ type: "text", text: labelText }]]));
    calls.length = 0;
    const r = await runStep0a(raw, "生徒");
    assert.equal(r.mode, "label");
    assert.equal(r.sentences, 6);
    assert.equal(r.unanchored, 0);
    // 講師(0・1)、生徒(2・3)、講師(4)、生徒「はい」、講師「あ、ごめん…」（文 5 を区切りで分けた）
    assert.equal(r.utterances.length, 5);
    assert.equal(r.utterances[3].original, "はい");
    assert.equal(r.utterances[4].original, "あ、ごめん会場はどこ市民会館です。");
    assert.equal(r.utterances[4].confidence, "低");
    const p = calls[0].params as { model: string; output_config: { effort: string; format?: { schema: { properties: Record<string, unknown> } } }; messages: { content: string }[]; system: { text: string }[] };
    assert.equal(p.model, "test-step0-model");
    assert.equal(p.output_config.effort, "low");
    assert.ok(p.output_config.format?.schema.properties.sentences);
    assert.ok(p.output_config.format?.schema.properties.splits);
    assert.match(p.messages[0].content, /\[0\] じゃあ始めようか。\n\[1\] 今日部活は。/);
    assert.match(p.messages[0].content, /\[5\] はいあ、ごめん会場はどこ市民会館です。/);
    assert.match(p.system[0].text, /本文は写さず/);
  });

  test("呼び出しごとに作り方・モデル・考える量を指定できる（copy は今の形）。runStep0 は作り方を記録に残す", async () => {
    const copyText = JSON.stringify({
      utterances: [
        { speaker: "講師", text: "じゃあ始めようか。今日部活は。", confidence: "高", reason: "" },
        { speaker: "生徒", text: "今日は早めに終わりました。顧問の先生が出張で。そっか、吹奏楽来月が最後のコンクールだっけ。はいあ、ごめん会場はどこ市民会館です。", confidence: "高", reason: "" },
      ],
      multiple_others: false,
      multiple_others_reason: "",
    });
    setClientForTests(fakeClient([() => [{ type: "text", text: copyText }], () => [{ type: "text", text: labelText }]]));
    calls.length = 0;
    const r = await runStep0a(raw, "生徒", { mode: "copy", model: "other-model", effort: "high" });
    assert.equal(r.mode, "copy");
    assert.equal(r.sentences, null);
    assert.equal(r.utterances.length, 2);
    const p = calls[0].params as { model: string; output_config: { effort: string; format?: { schema: { properties: Record<string, unknown> } } } };
    assert.equal(p.model, "other-model");
    assert.equal(p.output_config.effort, "high");
    assert.ok(p.output_config.format?.schema.properties.utterances);
    assert.equal(p.output_config.format?.schema.properties.sentences, undefined);

    const r0 = await runStep0(raw, "生徒", { with0b: false });
    assert.equal(r0.transcript.step0aMode, "label");
    assert.equal(r0.transcript.utterances.length, 5);
    assert.equal(r0.timing.step0a.model, "test-step0-model");
  });
});
