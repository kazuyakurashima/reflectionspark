import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findLoose, looseEquals, looseKey, normalizeLoose, similarity } from "./text.mts";

describe("ゆるい正規化（対応付けと当て直しにだけ使う。引用の照合には使わない）", () => {
  test("空白・句読点・記号を除き、全角の数字と英字を半角にする", () => {
    assert.equal(looseKey("土曜も 1日の時あるし、でも……最後なんで。"), "土曜も1日の時あるしでも最後なんで");
    assert.equal(looseKey("第一志望は南高って書いてくれてたよね。"), "第一志望は南高って書いてくれてたよね");
    assert.equal(looseKey("Ｄでした。"), "dでした");
  });

  test("元の文字位置への対応を残す", () => {
    const n = normalizeLoose("あ、い。う");
    assert.deepEqual(n.chars, ["あ", "い", "う"]);
    assert.deepEqual(n.index, [0, 2, 4]);
  });

  test("ゆるい一致", () => {
    assert.ok(looseEquals("変わってないです。南高には行きたいです。", "変わってないです 南高には行きたいです"));
    assert.ok(!looseEquals("南高", "難航"));
  });

  test("近さ", () => {
    assert.equal(similarity("はい", "はい。"), 1);
    assert.ok(similarity("四月の面談シートに", "4月の面談シートに") < 1);
    assert.ok(similarity("四月の面談シートに", "4月の面談シートに") > 0.8);
  });

  test("文字列の中から近い部分を探す（完全一致を先に、無ければ近い所）", () => {
    const hay = normalizeLoose("じゃあ始めようか。今日部活は。今日は早めに終わりました。顧問の先生が出張で。");
    const exact = findLoose(hay, "今日は早めに終わりました。");
    assert.ok(exact);
    assert.equal(exact.score, 1);
    assert.equal([...hay.original].slice(exact.start, exact.end).join(""), "今日は早めに終わりました");
    const near = findLoose(hay, "顧問の先生が出張です");
    assert.ok(near);
    assert.ok(near.score >= 0.6);
    assert.ok([...hay.original].slice(near.start, near.end).join("").startsWith("顧問の先生"));
    assert.equal(findLoose(hay, "まったく別の文です"), null);
  });
});
