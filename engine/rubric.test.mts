import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { scanText } from "./forbidden-words.mts";
import { step0aSystem, step1System, step2System, step2User, step3System, step4System } from "./prompts.mts";
import { computeTotal, RUBRIC_ITEMS, rubricBackground, rubricFull } from "./rubric.mts";

describe("採点表（初版・仮）", () => {
  test("5 項目があり、項目 5 は初回を保留にする（決まり 9）", () => {
    assert.equal(RUBRIC_ITEMS.length, 5);
    assert.match(RUBRIC_ITEMS[4].withhold, /初回/);
  });

  test("合計はアプリが計算し、保留した項目は分母から外す（決まり 8・9）", () => {
    const t = computeTotal([
      { item: 1, score: 4, reason: "", utterances: [] },
      { item: 2, score: 2, reason: "", utterances: [] },
      { item: 3, score: 3, reason: "", utterances: [] },
      { item: 4, score: 3, reason: "", utterances: [] },
      { item: 5, score: null, reason: "初回", utterances: [] },
    ]);
    assert.deepEqual(t, { sum: 12, judgedCount: 4, max: 20, scaled: 6 });
    assert.equal(computeTotal([{ item: 5, score: null, reason: "", utterances: [] }]).scaled, null);
  });

  test("採点表の文面とプロンプトに、性質の言葉の検出が当たらない（決まり 3）。禁止を伝える一文は除く", () => {
    const texts = [rubricBackground(), rubricFull(), step0aSystem("生徒"), step1System("生徒"), step2System("保護者"), step3System("コーチング"), step4System("生徒")];
    for (const t of texts) {
      const body = t.replace(/人物の性質を言い表す言葉（性格、タイプ、癖、傾向、「〜な人」）、優劣、「〜すべき」の断定を使わず、場面と行動を書きます。/g, "").replace(/相手の性格やタイプを推定しません。/g, "");
      assert.deepEqual(
        scanText(body, "prompt").map((h) => `${h.word}:${h.context}`),
        [],
      );
    }
  });

  test("工程 1 のプロンプトは、場面を 5 項目に縛らず、点を書かせない（決まり 4・8）", () => {
    const s = step1System("生徒");
    assert.match(s, /5 項目に縛りません/);
    assert.match(s, /点は書きません/);
    assert.doesNotMatch(s, /大丈夫、これからだよ/); // デモの山場を選ばせる指示を入れない
  });
});

describe("工程 2 に初回かどうかを渡す", () => {
  test("初回と続きで文が変わる", () => {
    assert.match(step2User([], [], true), /初回の面談です/);
    assert.match(step2User([], [], false), /続きの面談です/);
  });
});
