// 画面 1 の「確かめる所」を種類ごとに分ける（app/lib/check-groups.mts）。
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CHECK_CORRECTED, CHECK_LOW_CONFIDENCE, CHECK_MID_CONFIDENCE, CHECK_MULTIPLE_OTHERS, CHECK_SPEAKER_LABEL, CHECK_UNANCHORED } from "../engine/step0.mts";
import type { Transcript, Utterance } from "../engine/types.mts";
import {
  GAP_NOTICE,
  MARK_CORRECTED,
  MARK_EDITED,
  MARK_MULTIPLE,
  MARK_SPEAKER_LABEL,
  MARK_SPEAKER_LOW,
  MARK_SPEAKER_MID,
  MARK_UNANCHORED,
  countChecks,
  countToCheck,
  groupChecks,
  guessViews,
  isGap,
} from "./lib/check-groups.mts";

function u(index: number, check: string[], text = "x"): Utterance {
  return { index, speaker: "講師", text, original: text, confidence: "高", check, memoSpan: null };
}

describe("画面 1：確かめる所を種類ごとに分ける", () => {
  test("印の文字列が工程 0 の印と同じ", () => {
    assert.equal(MARK_SPEAKER_LOW, CHECK_LOW_CONFIDENCE);
    assert.equal(MARK_SPEAKER_MID, CHECK_MID_CONFIDENCE);
    assert.equal(MARK_SPEAKER_LABEL, CHECK_SPEAKER_LABEL);
    assert.ok(CHECK_UNANCHORED.startsWith(MARK_UNANCHORED));
    assert.equal(MARK_MULTIPLE, CHECK_MULTIPLE_OTHERS);
    assert.equal(MARK_CORRECTED, CHECK_CORRECTED);
    assert.equal(MARK_EDITED, "本人が直した");
  });

  test("一つの発話は一つの種類にだけ入り、聞き違いの直しは「前 → 後」ごとにまとめる", () => {
    const t: Transcript = {
      kind: "生徒",
      raw: "",
      multipleOthers: false,
      step0c: null,
      utterances: [
        u(0, []),
        u(1, [CHECK_MID_CONFIDENCE]), // 中だけは出さない
        u(2, [CHECK_LOW_CONFIDENCE, CHECK_CORRECTED]), // 話者を先に
        u(3, [CHECK_UNANCHORED + "（モデルの区切り：…）", CHECK_LOW_CONFIDENCE]), // 区切りを先に
        u(4, [CHECK_CORRECTED]),
        u(5, [CHECK_CORRECTED]),
        u(6, [CHECK_CORRECTED]),
        u(7, [CHECK_MULTIPLE_OTHERS]),
        u(8, [MARK_EDITED]),
      ],
      step0b: {
        proposed: [],
        discarded: [],
        applied: [
          { index: 2, kind: "同音の取り違え", before: "難航", after: "南高" },
          { index: 4, kind: "近い音の聞き違え", before: "南航", after: "南高" },
          { index: 5, kind: "近い音の聞き違え", before: "南航", after: "南高" },
          { index: 6, kind: "近い音の聞き違え", before: "南港", after: "南高" },
        ],
      },
    };
    const g = groupChecks(t);
    assert.deepEqual(g.unanchored.map((x) => x.index), [3]);
    assert.deepEqual(g.speaker.map((x) => x.index), [2]);
    assert.deepEqual(g.multiple.map((x) => x.index), [7]);
    assert.deepEqual(g.corrected.map((x) => x.index), [4, 5, 6]);
    assert.deepEqual(g.edited.map((x) => x.index), [8]);
    assert.equal(countChecks(g), 7);
    assert.equal(countToCheck(g), 3); // 直しは一つずつ見る所に数えない
    // 話者の所に入った 2 の直しは、まとめに数えない（その発話は一つずつ見るので）
    assert.deepEqual(
      g.correctionGroups.map((c) => [c.before, c.after, c.indices]),
      [
        ["南航", "南高", [4, 5]],
        ["南港", "南高", [6]],
      ],
    );
  });
});

describe("画面 1：推測（0c）を本文に当てる", () => {
  const base = (utterances: Utterance[], applied: Transcript["step0b"]["applied"], guesses: NonNullable<Transcript["step0c"]>["guesses"]): Transcript => ({
    kind: "生徒",
    raw: "",
    multipleOthers: false,
    utterances,
    step0b: { proposed: [], discarded: [], applied },
    step0c: { summary: "", guesses },
  });

  test("0b の直しで既に同じ言葉になった推測は出さず、まだの推測は置き換えた本文を返す", () => {
    const u83: Utterance = { ...u(0, [CHECK_CORRECTED]), text: "3時間もっとかもいたら寝るのには", original: "3時間もっとかもいたら練るのには" };
    const u39: Utterance = { ...u(1, [CHECK_CORRECTED]), text: "Dでした。はいだから", original: "でしたかはいだから" };
    const u84: Utterance = { ...u(2, []), text: "いっちゃ塾の宿題は", original: "いっちゃ塾の宿題は" };
    const t = base(
      [u83, u39, u84],
      [
        { index: 0, kind: "同音の取り違え", before: "練る", after: "寝る" },
        { index: 1, kind: "欠けた音", before: "でしたかはい", after: "Dでした。はい" },
      ],
      [
        { index: 0, kind: "崩れ", fragment: "いたら練るのには", guess: "気づいたら寝る時には", clue: "" },
        { index: 1, kind: "崩れ", fragment: "でしたかはい", guess: "Dでした", clue: "" },
        { index: 2, kind: "崩れ", fragment: "いっちゃ", guess: "じゃあ", clue: "" },
      ],
    );
    // 83：0b の直しを当てた形（いたら寝るのには）で本文から探して置き換える
    assert.deepEqual(guessViews(t, u83).map((g) => [g.target, g.applied]), [["いたら寝るのには", "3時間もっとかも気づいたら寝る時には"]]);
    // 39：推測の言葉（Dでした）が既に本文にあるので出さない
    assert.deepEqual(guessViews(t, u39), []);
    // 84：印が無くても推測があれば確かめる所に入る
    assert.deepEqual(guessViews(t, u84).map((g) => g.applied), ["じゃあ塾の宿題は"]);
    const g = groupChecks(t);
    assert.deepEqual(g.guessed.map((x) => x.index), [0, 2]);
    assert.deepEqual(g.corrected.map((x) => x.index), [1]);
    assert.equal(countToCheck(g), 2);
  });

  test("「抜け」（設計書 工程 0c）は推測の文を持たず、置き換えた本文を作らない（「この推測で直す」を出さない）。確かめる所には入る", () => {
    const u0: Utterance = { ...u(0, [CHECK_LOW_CONFIDENCE]), text: "会場はどこ市民会館です。", original: "会場はどこ市民会館です。" };
    const u1: Utterance = { ...u(1, []), text: "らいげつの予定は。", original: "らいげつの予定は。" };
    const t = base(
      [u0, u1],
      [],
      [
        { index: 0, kind: "抜け", fragment: "会場はどこ市民会館", guess: "", clue: "問いの直後に返事が無く、相手の言葉が続いている" },
        { index: 1, kind: "崩れ", fragment: "らいげつ", guess: "来月", clue: "音が近い" },
      ],
    );
    const views = guessViews(t, u0);
    assert.equal(views.length, 1); // 推測の文が空でも「本文に既に入っている」とは見ない
    assert.ok(isGap(views[0]));
    assert.equal(views[0].target, "会場はどこ市民会館"); // 色を付ける所
    assert.equal(views[0].applied, null); // 置き換えた本文は作らない
    assert.deepEqual(guessViews(t, u1).map((g) => [isGap(g), g.applied]), [[false, "来月の予定は。"]]);
    const g = groupChecks(t);
    // 話者の確からしさが低い発話は話者の所へ、抜けだけの発話は「意味が通らない所」へ（最初に当たった種類にだけ入れる）
    assert.deepEqual(g.speaker.map((x) => x.index), [0]);
    assert.deepEqual(g.guessed.map((x) => x.index), [1]);
    assert.deepEqual(groupChecks({ ...t, utterances: [{ ...u0, check: [] }, u1] }).guessed.map((x) => x.index), [0, 1]);
    // 画面の文：推測できないと言い、本人が直す道（本文を直す・カーソルの位置で分ける）と、そのままでよいことを書く
    assert.match(GAP_NOTICE, /言葉が抜けていて推測できません/);
    assert.match(GAP_NOTICE, /「本文を直す」/);
    assert.match(GAP_NOTICE, /「カーソルの位置で分ける」/);
    assert.match(GAP_NOTICE, /そのままでかまいません/);
  });
});
