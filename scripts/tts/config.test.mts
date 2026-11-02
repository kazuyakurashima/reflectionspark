import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { checkSpeakersKnown, describeSpeaker, parseConfig, speakersMissingVoiceId } from "./config.mts";
import { parseDialogue } from "./dialogue.mts";

const base = {
  models: ["eleven_v4", "eleven_v3"],
  outputFormat: "mp3_44100_128",
  maxCharsPerRequest: 2000,
  speakers: {
    講師: { voiceName: "Hajisan", voiceId: "id-teacher" },
    生徒: { voiceName: "Sky", voiceId: "" },
  },
};

describe("声の設定", () => {
  test("リポジトリの voices.json が読める。講師は Hajisan、生徒は Sky", async () => {
    const json = JSON.parse(await readFile(new URL("./voices.json", import.meta.url), "utf8"));
    const config = parseConfig(json);
    assert.deepEqual(config.models, ["eleven_v4", "eleven_v3"]);
    assert.equal(config.speakers["講師"].voiceName, "Hajisan");
    assert.equal(config.speakers["生徒"].voiceName, "Sky");
  });

  test("リポジトリの voices.json に、声の ID 以外の秘密を置く項目は無い", async () => {
    const text = await readFile(new URL("./voices.json", import.meta.url), "utf8");
    assert.doesNotMatch(text, /api[_-]?key|xi-api-key|sk_/i);
  });

  test("任意の項目は、書いたときだけ持つ", () => {
    assert.equal("languageCode" in parseConfig(base), false);
    const config = parseConfig({ ...base, languageCode: "ja", seed: 42, stability: 0.5 });
    assert.equal(config.languageCode, "ja");
    assert.equal(config.seed, 42);
    assert.equal(config.stability, 0.5);
  });

  test("おかしな項目はまとめて知らせる", () => {
    assert.throws(
      () =>
        parseConfig({
          models: [],
          outputFormat: "pcm_44100",
          maxCharsPerRequest: 0,
          stability: 2,
          speakers: { 講師: {} },
        }),
      (err: Error) => {
        assert.match(err.message, /models/);
        assert.match(err.message, /outputFormat は mp3_/);
        assert.match(err.message, /maxCharsPerRequest/);
        assert.match(err.message, /stability/);
        assert.match(err.message, /「講師」に voiceId/);
        return true;
      },
    );
  });

  test("声の ID の前後の空白は除く", () => {
    const config = parseConfig({ ...base, speakers: { 講師: { voiceId: "  abc \n" } } });
    assert.equal(config.speakers["講師"].voiceId, "abc");
  });

  test("台本に設定の無い話者がいれば、行番号を添えて知らせる", () => {
    const config = parseConfig(base);
    const utterances = parseDialogue("講師：始めよう。\n先生：はい。\n講師：うん。\n先生：ええ。");
    assert.throws(() => checkSpeakersKnown(utterances, config), /「先生」（2・4 行目）.*講師・生徒/);
  });

  test("台本に出てくる話者のうち、声の ID が空のものを返す", () => {
    const config = parseConfig(base);
    const utterances = parseDialogue("講師：始めよう。\n生徒：はい。\n生徒：ええ。");
    assert.deepEqual(speakersMissingVoiceId(utterances, config), ["生徒"]);
    assert.deepEqual(speakersMissingVoiceId(parseDialogue("講師：始めよう。"), config), []);
  });

  test("話者名に覚え書きの声の名前を添える", () => {
    const config = parseConfig({ ...base, speakers: { ...base.speakers, 保護者: { voiceId: "" } } });
    assert.equal(describeSpeaker("講師", config), "講師（Hajisan）");
    assert.equal(describeSpeaker("保護者", config), "保護者");
  });
});
