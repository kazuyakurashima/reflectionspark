// API は呼ばない。fetch を差し替えて、送る中身・モデルの切り替え・やり直し・途中からの再開を確かめる。

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { parseConfig } from "./config.mts";
import { parseDialogue, splitIntoChunks } from "./dialogue.mts";
import {
  API_URL,
  ApiError,
  buildRequestBody,
  partFileName,
  requestDialogue,
  synthesize,
} from "./elevenlabs.mts";
import type { DialogueRequestBody, Deps } from "./elevenlabs.mts";

const config = parseConfig({
  models: ["eleven_v4", "eleven_v3"],
  outputFormat: "mp3_44100_128",
  maxCharsPerRequest: 40,
  speakers: {
    講師: { voiceName: "Hajisan", voiceId: "voice-teacher" },
    生徒: { voiceName: "Sky", voiceId: "voice-student" },
  },
});

const script = [
  "講師：じゃあ、始めようか。",
  "生徒：[hesitates] はい……お願いします。",
  "講師：先週の小テスト、どうだった？",
  "生徒：文章題が時間切れでした。",
].join("\n");

const chunks = splitIntoChunks(parseDialogue(script), config.maxCharsPerRequest);

type Call = { url: string; init: RequestInit; body: DialogueRequestBody };

/** 決めた順に応答を返す fetch。呼ばれた中身を calls に残す。 */
function fakeFetch(responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch: Deps["fetch"] = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) });
    const next = responses.shift();
    if (next === undefined) throw new Error("想定より多く呼ばれました");
    return next();
  };
  return { fetch, calls };
}

const audio = (byte: number) => () =>
  new Response(new Uint8Array([0xff, 0xfb, byte]), { status: 200, headers: { "content-type": "audio/mpeg" } });
const error = (status: number, body = "{}", headers: Record<string, string> = {}) => () =>
  new Response(body, { status, headers });

function deps(fetch: Deps["fetch"]) {
  const logs: string[] = [];
  const sleeps: number[] = [];
  const d: Deps = {
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (m) => logs.push(m),
  };
  return { deps: d, logs, sleeps };
}

describe("API に送る中身", () => {
  test("台本が 2 回以上に分かれる（このテストの前提）", () => {
    assert.ok(chunks.length >= 2);
  });

  test("発話ごとに本文と声の ID を並べ、演技の指示もそのまま送る", () => {
    const body = buildRequestBody(chunks[0], "eleven_v4", config);
    assert.equal(body.model_id, "eleven_v4");
    assert.deepEqual(body.inputs[0], { text: "じゃあ、始めようか。", voice_id: "voice-teacher" });
    assert.deepEqual(body.inputs[1], { text: "[hesitates] はい……お願いします。", voice_id: "voice-student" });
  });

  test("任意の項目は、設定に書いたときだけ送る", () => {
    assert.deepEqual(Object.keys(buildRequestBody(chunks[0], "eleven_v4", config)), ["inputs", "model_id"]);
    const withOptions = parseConfig({ ...config, languageCode: "ja", seed: 7, stability: 0.5 });
    const body = buildRequestBody(chunks[0], "eleven_v4", withOptions);
    assert.equal(body.language_code, "ja");
    assert.equal(body.seed, 7);
    assert.deepEqual(body.settings, { stability: 0.5 });
  });

  test("声の ID が空の話者がいれば送らない", () => {
    const noId = parseConfig({ ...config, speakers: { 講師: { voiceId: "" }, 生徒: { voiceId: "x" } } });
    assert.throws(() => buildRequestBody(chunks[0], "eleven_v4", noId), /「講師」の声の ID/);
  });

  test("キーは xi-api-key のヘッダーで送り、出力の形は output_format で指定する", async () => {
    const { fetch, calls } = fakeFetch([audio(1)]);
    await requestDialogue(buildRequestBody(chunks[0], "eleven_v4", config), {
      apiKey: "test-key",
      outputFormat: "mp3_44100_128",
    }, deps(fetch).deps);
    assert.equal(calls[0].url, `${API_URL}?output_format=mp3_44100_128`);
    assert.equal(calls[0].init.method, "POST");
    assert.equal((calls[0].init.headers as Record<string, string>)["xi-api-key"], "test-key");
  });
});

describe("やり直し", () => {
  const body = buildRequestBody(chunks[0], "eleven_v4", config);
  const opts = { apiKey: "k", outputFormat: "mp3_44100_128" };

  test("429 と 5xx は待ってやり直す。Retry-After があればそれだけ待つ", async () => {
    const { fetch, calls } = fakeFetch([error(503), error(429, "{}", { "retry-after": "5" }), audio(9)]);
    const d = deps(fetch);
    const bytes = await requestDialogue(body, opts, d.deps);
    assert.deepEqual([...bytes], [0xff, 0xfb, 9]);
    assert.equal(calls.length, 3);
    assert.deepEqual(d.sleeps, [2000, 5000]);
  });

  test("つながらないときも待ってやり直し、続けば諦める", async () => {
    const fail = () => {
      throw new TypeError("fetch failed");
    };
    const { fetch, calls } = fakeFetch([fail, fail, fail, fail]);
    const d = deps(fetch);
    await assert.rejects(requestDialogue(body, opts, d.deps), /つながりませんでした：fetch failed/);
    assert.equal(calls.length, 4);
    assert.deepEqual(d.sleeps, [2000, 4000, 8000]);
  });

  test("401 はやり直さず、キーを確かめるよう知らせる", async () => {
    const { fetch, calls } = fakeFetch([error(401, '{"detail":"invalid_api_key"}')]);
    await assert.rejects(requestDialogue(body, opts, deps(fetch).deps), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.match(err.message, /ELEVENLABS_API_KEY/);
      assert.match(err.message, /invalid_api_key/);
      return true;
    });
    assert.equal(calls.length, 1);
  });

  test("200 でも音声でなければ失敗にする", async () => {
    const { fetch } = fakeFetch([
      () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    await assert.rejects(requestDialogue(body, opts, deps(fetch).deps), /音声が返ってきませんでした/);
  });
});

describe("モデルの切り替えと途中からの再開", () => {
  let partsDir: string;
  beforeEach(async () => {
    partsDir = path.join(await mkdtemp(path.join(tmpdir(), "tts-test-")), "out.parts");
  });
  afterEach(async () => {
    await rm(path.dirname(partsDir), { recursive: true, force: true });
  });

  const run = (fetch: Deps["fetch"], models = config.models) => {
    const d = deps(fetch);
    return { promise: synthesize({ chunks, config, models, apiKey: "k", partsDir }, d.deps), ...d };
  };

  test("先頭のモデルで作れれば、分けた分を順にすべて作る", async () => {
    const { fetch, calls } = fakeFetch(chunks.map((_, i) => audio(i)));
    const result = await run(fetch).promise;
    assert.equal(result.model, "eleven_v4");
    assert.deepEqual(
      result.parts.map((p) => p[2]),
      chunks.map((_, i) => i),
    );
    assert.ok(calls.every((c) => c.body.model_id === "eleven_v4"));
    assert.deepEqual(
      calls.map((c) => c.body.inputs.length),
      chunks.map((c) => c.utterances.length),
    );
  });

  test("先頭のモデルが使えなければ（400 など）、次のモデルで最初から作り、1 本の中で混ぜない", async () => {
    const { fetch, calls } = fakeFetch([
      error(400, '{"detail":{"status":"model_not_found"}}'),
      ...chunks.map((_, i) => audio(i)),
    ]);
    const r = run(fetch);
    const result = await r.promise;
    assert.equal(result.model, "eleven_v3");
    assert.deepEqual(
      calls.map((c) => c.body.model_id),
      ["eleven_v4", ...chunks.map(() => "eleven_v3")],
    );
    assert.ok(r.logs.some((l) => l.includes("eleven_v4 は使えませんでした（400）")));
  });

  test("どのモデルも使えなければ、それぞれの理由をまとめて知らせる", async () => {
    const { fetch } = fakeFetch([error(400, "v4 だめ"), error(422, "v3 だめ")]);
    await assert.rejects(run(fetch).promise, (err: Error) => {
      assert.match(err.message, /どのモデルでも作れませんでした/);
      assert.match(err.message, /eleven_v4：.*400[\s\S]*v4 だめ/);
      assert.match(err.message, /eleven_v3：.*422[\s\S]*v3 だめ/);
      return true;
    });
  });

  test("2 回目以降の失敗では、モデルを切り替えない", async () => {
    const { fetch, calls } = fakeFetch([audio(0), error(400, "bad")]);
    await assert.rejects(run(fetch).promise, (err: unknown) => err instanceof ApiError && err.status === 400);
    assert.deepEqual(
      calls.map((c) => c.body.model_id),
      ["eleven_v4", "eleven_v4"],
    );
  });

  test("--model で 1 つに絞ったときは、切り替えずに失敗を知らせる", async () => {
    const { fetch, calls } = fakeFetch([error(400, "bad")]);
    await assert.rejects(run(fetch, ["eleven_v4"]).promise, ApiError);
    assert.equal(calls.length, 1);
  });

  test("途中で失敗しても作った分は残り、次に回すと残りの分だけを送る", async () => {
    const first = fakeFetch([audio(0), error(401)]);
    await assert.rejects(run(first.fetch).promise, ApiError);
    assert.equal((await readdir(partsDir)).length, 1);

    const second = fakeFetch(chunks.slice(1).map((_, i) => audio(i + 1)));
    const result = await run(second.fetch).promise;
    assert.equal(result.reused, 1);
    assert.equal(second.calls.length, chunks.length - 1);
    assert.deepEqual(
      result.parts.map((p) => p[2]),
      chunks.map((_, i) => i),
    );
  });

  test("送る中身が変われば、前に作った分は使わない", () => {
    const a = buildRequestBody(chunks[0], "eleven_v4", config);
    const b = { ...a, inputs: [{ ...a.inputs[0], text: "別の本文" }, ...a.inputs.slice(1)] };
    assert.notEqual(partFileName(0, a, "mp3_44100_128"), partFileName(0, b, "mp3_44100_128"));
    assert.notEqual(partFileName(0, a, "mp3_44100_128"), partFileName(0, { ...a, model_id: "eleven_v3" }, "mp3_44100_128"));
    assert.match(partFileName(0, a, "mp3_44100_128"), /^01-[0-9a-f]{12}\.mp3$/);
  });
});
