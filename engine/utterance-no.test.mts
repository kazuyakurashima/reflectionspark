// 発話番号の決まり（docs/設計書.md「工程の間で守ること」）。番号は一つで、0 始まり。
// 並びの位置・citations の start_block_index・AI に渡す札・画面に出す番号が同じ数になることを守る。
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { blockText, blockTexts, verifyCitation } from "./citations.mts";
import { step1System, step4System, step4UserText } from "./prompts.mts";
import { keyIn, parseStep1 } from "./step1.mts";
import { parseStep4 } from "./step4.mts";
import { splitUtterance } from "./transcript-edit.mts";
import type { Transcript, Utterance } from "./types.mts";
import {
  blockLabel,
  checkUtteranceRefs,
  findUtteranceIndices,
  findUtteranceRefs,
  markPreviousUtteranceRefs,
  parseUtteranceList,
  toUtteranceIndex,
  toUtteranceIndices,
  utteranceLabel,
  utteranceListLabel,
  utteranceRangeLabel,
  utterancesAround,
} from "./utterance-no.mts";

const texts = ["じゃあ、始めようか。", "はい。お願いします。", "この前の模試、どうだった。", "正直、だめでした。", "そっか。どこがだめだったと思う。", "数学です。"];
const utterances: Utterance[] = texts.map((t, i) => ({ index: i, speaker: i % 2 === 0 ? "講師" : "生徒", text: t, original: t, confidence: "高" as const, check: [], memoSpan: null }));
const transcript: Transcript = { kind: "生徒", raw: texts.join(""), utterances, multipleOthers: false, step0b: { proposed: [], applied: [], discarded: [] }, step0c: null };

describe("発話番号の決まり（番号は一つ。0 始まり）", () => {
  test("呼び方と札の書き方は一か所で決まる", () => {
    assert.equal(utteranceLabel(40), "発話 40");
    assert.equal(blockLabel(40), "〔発話 40〕");
    assert.equal(utteranceListLabel([3, 5, 8]), "発話 3、5、8");
    assert.equal(utteranceRangeLabel(3, 8), "発話 3〜8");
    assert.equal(utteranceRangeLabel(3, 3), "発話 3");
  });

  test("札の番号＝並びの位置＝ citations の start_block_index。最初の発話が 0", () => {
    const blocks = blockTexts(utterances);
    blocks.forEach((b, i) => assert.ok(b.startsWith(`${blockLabel(i)}${utterances[i].speaker}：`), b));
    // 並びの i 番目のブロックを引用すると、発話番号 i の引用になり、本文は i 番目の発話と同じ
    blocks.forEach((b, i) => {
      const q = verifyCitation({ type: "content_block_location", cited_text: b, document_index: 0, document_title: null, file_id: null, start_block_index: i, end_block_index: i + 1 }, utterances);
      assert.equal(q.verified, true);
      assert.equal(q.index, i);
      assert.equal(q.text, utterances[i].text);
    });
  });

  test("index が並びの位置とずれた発話があっても、札は位置から付ける（札と start_block_index が食い違わない）", () => {
    const broken = utterances.map((u, i) => (i === 2 ? { ...u, index: 99 } : u));
    assert.ok(blockTexts(broken)[2].startsWith("〔発話 2〕"));
    assert.ok(blockText(broken[2], 2).startsWith("〔発話 2〕"));
  });

  test("画面 1 で発話を分けた後も、index は並びの位置と同じで、札も続き番号になる", () => {
    const t2 = splitUtterance(transcript, 2, 6);
    assert.equal(t2.utterances.length, utterances.length + 1);
    t2.utterances.forEach((u, i) => assert.equal(u.index, i));
    blockTexts(t2.utterances).forEach((b, i) => assert.ok(b.startsWith(blockLabel(i))));
  });

  test("AI が返した番号は、整数で範囲の中のものだけを受け取る", () => {
    assert.equal(toUtteranceIndex(0, 6), 0);
    assert.equal(toUtteranceIndex(5, 6), 5);
    assert.equal(toUtteranceIndex(6, 6), null);
    assert.equal(toUtteranceIndex(-1, 6), null);
    assert.equal(toUtteranceIndex(1.5, 6), null);
    assert.equal(toUtteranceIndex("3", 6), null);
    assert.deepEqual(toUtteranceIndices([0, 6, 2, -1, 5], 6), [0, 2, 5]);
  });

  test("文の中の「発話 n」を読む（範囲・並べた番号・全角の数字）", () => {
    assert.deepEqual(findUtteranceRefs("発話 12 で講師が尋ね、発話13で生徒が答えた。"), [12, 13]);
    assert.deepEqual(findUtteranceRefs("発話 36〜77：模試の話"), [36, 77]);
    assert.deepEqual(findUtteranceRefs("発話 45・47 の説明のあと、発話 51、52 で"), [45, 47, 51, 52]);
    assert.deepEqual(findUtteranceRefs("発話 ４０ と発話 41"), [40, 41]);
    assert.deepEqual(findUtteranceRefs("番号の無い文。3 分の小テスト。"), []);
    assert.deepEqual(findUtteranceRefs("発話 12ー15 と発話 20-22"), [12, 15, 20, 22]);
  });

  test("数のあとに助数詞が続くものは、発話番号として読まない", () => {
    assert.deepEqual(findUtteranceRefs("発話 3 と 5 つの候補"), [3]);
    assert.deepEqual(findUtteranceRefs("発話 3 と 15 つの候補"), [3]);
    assert.deepEqual(findUtteranceRefs("発話 3 つ分の説明"), []);
    assert.deepEqual(findUtteranceRefs("発話 3 と 5 で"), [3, 5]);
  });

  test("文の中の番号が範囲の外にあれば分かる（番号のずれの見張り）", () => {
    assert.deepEqual(checkUtteranceRefs(["発話 0 から発話 5 まで", null, "発話 3"], 6), { total: 3, outOfRange: [] });
    // 1 から数えた文は、最後の発話が範囲の外に出る
    assert.deepEqual(checkUtteranceRefs(["発話 1〜6：全体"], 6), { total: 2, outOfRange: [6] });
  });

  test("負の番号は、番号の誤りとして範囲の外に記録する（「発話 3-5」の範囲とは分ける）", () => {
    assert.deepEqual(findUtteranceRefs("発話 -1"), [-1]);
    assert.deepEqual(checkUtteranceRefs(["発話 -1", "発話 3、発話 -2"], 6), { total: 3, outOfRange: [-2, -1] });
    assert.deepEqual(checkUtteranceRefs(["発話 3-5"], 6), { total: 2, outOfRange: [] });
  });

  test("前回の面談の番号は、今回の範囲検査に数えない。今回の番号だけを確かめる", () => {
    assert.deepEqual(checkUtteranceRefs(["前回の面談の発話 94 と比べて、今回の発話 2 では問いが出た。"], 3), { total: 1, outOfRange: [] });
    assert.deepEqual(checkUtteranceRefs(["前回の発話 94 と 95 のあと、発話 7 で"], 3), { total: 1, outOfRange: [7] });
    assert.deepEqual(checkUtteranceRefs(["前回の面談の発話 94、発話 7"], 3), { total: 1, outOfRange: [7] });
  });

  test("引用した発話と、直前・直後を並びから取る（端では無い側を出さない。広げると前後が増える）", () => {
    assert.deepEqual(utterancesAround(utterances, 2, 3).map((u) => u.index), [1, 2, 3]);
    assert.deepEqual(utterancesAround(utterances, 0, 1).map((u) => u.index), [0, 1]);
    assert.deepEqual(utterancesAround(utterances, 5, 6).map((u) => u.index), [4, 5]);
    assert.deepEqual(utterancesAround(utterances, 2, 4).map((u) => u.index), [1, 2, 3, 4]);
    assert.deepEqual(utterancesAround(utterances, 2, 3, 3).map((u) => u.index), [0, 1, 2, 3, 4, 5]);
  });
});

describe("前回の面談の番号は、今回の面談の番号と分ける", () => {
  test("前回の面談について書いた文の「発話 n」に、前回の面談の番号だと分かる印を付ける（二重には付けない）", () => {
    assert.equal(markPreviousUtteranceRefs("発話 75 の数学の目標と、発話 94 から発話 104 の説明"), "前回の面談の発話 75 の数学の目標と、前回の面談の発話 94 から前回の面談の発話 104 の説明");
    assert.equal(markPreviousUtteranceRefs("発話 38・40 で話した"), "前回の面談の発話 38・40 で話した");
    assert.equal(markPreviousUtteranceRefs("前回の面談の発話 75 で"), "前回の面談の発話 75 で");
    assert.equal(markPreviousUtteranceRefs("番号の無い文。"), "番号の無い文。");
  });

  test("並べた番号も一度で印が付き、何度かけても同じ文になる", () => {
    const once = markPreviousUtteranceRefs("発話 3、発話 5、発話 7");
    assert.equal(once, "前回の面談の発話 3、前回の面談の発話 5、前回の面談の発話 7");
    assert.equal(markPreviousUtteranceRefs(once), once);
    assert.equal(markPreviousUtteranceRefs("前回の発話 3 と発話 5"), "前回の発話 3 と前回の面談の発話 5");
    assert.equal(markPreviousUtteranceRefs("発話 3 つ分の説明"), "発話 3 つ分の説明");
  });

  test("工程 4 に渡す前回の場面の文には、印の無い「発話 n」が残らない。前回の引用の言葉は変えない", () => {
    const text = step4UserText("生徒", {
      sentence: "もし相手が心配を口にしたなら、何が心配かを尋ねる。",
      criterion: "相手の心配の直後に、本人の問いがある。",
      previousScene: { context: "家での時間を尋ねた後の場面（発話 88〜93）。", quoteText: "大丈夫。これからだよ。", reading: "発話 75 の目標と結ばないまま、発話 94 から説明に移ったと読める。" },
    });
    assert.match(text, /前回の面談の発話 88〜93/);
    assert.match(text, /前回の面談の発話 75 の目標/);
    assert.match(text, /前回の面談の発話 94 から/);
    assert.match(text, /前回の引用：大丈夫。これからだよ。/);
    assert.equal(text.match(/(?<!前回の面談の)発話\s*[0-9]+/g), null);
    assert.match(text, /この中の発話番号は前回の面談の番号で、今回の文書の札の番号ではない/);
  });
});

describe("工程 1・4：番号は札から読ませ、返ってきた番号は確かめる", () => {
  test("プロンプトは、札の番号で発話を指し、自分で数え直さないことを求める", () => {
    for (const sys of [step1System("生徒"), step4System("生徒")]) {
      assert.match(sys, /各ブロックの先頭に〔発話 n〕の札/);
      assert.match(sys, /最初の発話が〔発話 0〕/);
      assert.match(sys, /自分で数え直[さし]/);
    }
  });

  test("工程 1：文の中の番号を数え、範囲の外の番号と、範囲の外の次点を残さない", () => {
    const text = `<scene type="よく表れた所">
<items>1</items>
<context>模試の結果を聞いた所（発話 2〜3）。</context>
<quote>そっか。どこがだめだったと思う。</quote>
<observation>発話 4 で講師が尋ねた。</observation>
<reaction>発話 5 で生徒が答えた。</reaction>
<reading>発話 6 まで続いたと読める。</reading>
<question>q</question>
<why_chosen>w</why_chosen>
<runner_up>2, 9</runner_up>
</scene>
<summary>s</summary>
<flow>
発話 0〜1：始まり
発話 2〜5：模試
</flow>
<extra_question></extra_question>`;
    const r = parseStep1(text, [], utterances);
    assert.deepEqual(r.scenes[0].record.runnerUp, [2]);
    assert.deepEqual(r.utteranceRefs, { total: 9, outOfRange: [6] });
  });

  test("工程 4：点の根拠の番号は範囲の中だけを受け取り、文の中の番号も確かめる", () => {
    const text = `<verdict>一部</verdict>
<quote></quote>
<why>発話 4 で問いが出て、発話 5 で生徒が答えた。</why>
<items>
<item n="1" score="3" utterances="3, 4, 6">発話 3 を受けた。</item>
<item n="2" score="3" utterances="">x</item>
<item n="3" score="3" utterances="">x</item>
<item n="4" score="3" utterances="">x</item>
<item n="5" score="3" utterances="2">発話 2 で前回に触れた。</item>
</items>
<other_line></other_line>`;
    const r = parseStep4(text, [], utterances);
    assert.deepEqual(r.items[0].utterances, [3, 4]);
    assert.deepEqual(r.items[4].utterances, [2]);
    assert.deepEqual(r.utteranceRefs, { total: 4, outOfRange: [] });
  });
});

describe("工程 1：番号を文から分けた欄（11/8）", () => {
  test("欄の番号は、範囲を広げ、重ねず、小さい順に読む", () => {
    assert.deepEqual(parseUtteranceList("発話 93〜95、発話 73、発話 75"), [73, 75, 93, 94, 95]);
    assert.deepEqual(parseUtteranceList("93, 95-97"), [93, 95, 96, 97]);
    assert.deepEqual(parseUtteranceList(""), []);
    // 広すぎる範囲は、両端だけを残す（一つの場面で 60 発話を超えて指すことは無いため）
    assert.deepEqual(parseUtteranceList("発話 1〜500"), [1, 500]);
  });

  test("前の作りの出力は、文の中の「発話 n」から番号を読む", () => {
    assert.deepEqual(findUtteranceIndices("発話 4 で尋ね、発話 5〜6 で生徒が答えたと読める。"), [4, 5, 6]);
    assert.deepEqual(findUtteranceIndices("番号の無い文。"), []);
  });

  test("読み・観察・反応の番号を欄から読み、並びの範囲の外は捨てる。文の中には番号が無くてよい", () => {
    const text = `<scene type="次に試せる所">
<items>3</items>
<context>苦手な単元を尋ねた所。</context>
<quote>そっか。どこがだめだったと思う。</quote>
<observation>講師が、どこがだめだったかを尋ねた。</observation>
<observation_refs>発話 4</observation_refs>
<reaction>生徒が単元を一つ挙げた。</reaction>
<reaction_refs>発話 5</reaction_refs>
<reading>理由を尋ねる前に話が次へ移ったと読める。</reading>
<reading_refs>発話 2〜4、発話 9</reading_refs>
<as_choice>時間の都合があった可能性。</as_choice>
<question>次に同じ場面が来たら、何を試しますか。</question>
<why_chosen>w</why_chosen>
<runner_up></runner_up>
</scene>
<summary>s</summary>
<flow>
発話 0〜5：模試
</flow>`;
    const r = parseStep1(text, [], utterances);
    assert.deepEqual(r.scenes[0].refs, { reading: [2, 3, 4], observation: [4], reaction: [5] });
    assert.equal(r.extraQuestion, null);
  });

  test("工程 1 のプロンプトは、文の中に番号を書かせず、番号の欄を場面ごとに置く。事情を尋ねる問いは書かせない（決まり 2・6）", () => {
    const s = step1System("生徒");
    assert.match(s, /発話番号も書きません/);
    for (const tag of ["reading_refs", "observation_refs", "reaction_refs"]) {
      assert.equal(s.split(`</${tag}>`).length - 1, 2, tag); // 出力の形の、2 つの場面の両方に
    }
    assert.doesNotMatch(s, /<extra_question>/);
    // 面談の流れの行の頭は、発話の範囲（地図の区切りに使う）
    assert.match(s, /発話 0〜11：/);
  });
});

describe("工程 1：見立ての要の一句（11/8）", () => {
  test("要の一句は、読みの文にそのまま入っているときだけ受け取る", () => {
    const reading = "気持ちを尋ねたことが、志望を口にすることにつながったと読める。";
    assert.equal(keyIn(reading, " 志望を口にすることにつながった "), "志望を口にすることにつながった");
    assert.equal(keyIn(reading, "志望を自分から口にした"), null); // 読みに無い言葉
    assert.equal(keyIn(reading, ""), null);
    assert.equal(keyIn(reading, reading), null); // 文の全体は要ではない
  });

  test("出力の欄から読み、読みに無い句は捨てる", () => {
    const text = `<scene type="よく表れた所">
<items></items>
<context>c</context>
<quote>q</quote>
<observation>o</observation>
<reaction>r</reaction>
<reading>気持ちを尋ねたことが、志望を口にすることにつながったと読める。</reading>
<reading_key>志望を口にすることにつながった</reading_key>
<reading_refs>発話 2</reading_refs>
<why_chosen>w</why_chosen>
<runner_up></runner_up>
</scene>
<scene type="次に試せる所">
<items></items>
<context>c</context>
<quote>q</quote>
<observation>o</observation>
<reaction>r</reaction>
<reading>説明に移ったと読める。</reading>
<reading_key>説明が長かった</reading_key>
<reading_refs></reading_refs>
<as_choice>a</as_choice>
<question>次に同じ場面が来たら、何を試しますか。</question>
<why_chosen>w</why_chosen>
<runner_up></runner_up>
</scene>
<summary>s</summary>
<flow>
発話 0〜5：模試
</flow>`;
    const r = parseStep1(text, [], utterances);
    assert.equal(r.scenes[0].readingKey, "志望を口にすることにつながった");
    assert.equal(r.scenes[1].readingKey, null);
  });

  test("工程 1 のプロンプトは、両方の場面に要の一句の欄を置き、読みから写させる", () => {
    const s = step1System("生徒");
    assert.equal(s.split("</reading_key>").length - 1, 2);
    assert.match(s, /読みの文から一字も変えずに写した/);
  });
});
