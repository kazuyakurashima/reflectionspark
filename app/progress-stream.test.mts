// 進み具合を 1 行ずつ流し、画面で読む（app/lib/progress-stream.mts）。失敗は失敗として届く。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProgressEvent } from "../engine/progress.mts";
import { progressResponse, readProgress, wantsProgress } from "./lib/progress-stream.mts";

describe("進み具合を流して読む", () => {
  it("進み具合を順に受け取り、最後に結果を返す", async () => {
    const res = progressResponse(async (on) => {
      on({ stage: "0a" });
      on({ stage: "0a", done: 120, total: 300, unit: "字" });
      on({ stage: "0b" });
      return { ok: true, n: 3 };
    });
    const got: ProgressEvent[] = [];
    const data = await readProgress<{ ok: boolean; n: number }>(res, (e) => got.push(e), "失敗しました");
    assert.deepEqual(data, { ok: true, n: 3 });
    assert.deepEqual(got, [{ stage: "0a" }, { stage: "0a", done: 120, total: 300, unit: "字" }, { stage: "0b" }]);
  });

  it("途中で失敗したら、その文で投げる", async () => {
    const res = progressResponse(async (on) => {
      on({ stage: "0a" });
      throw new Error("呼び出しが切れた");
    }, "整形に失敗しました：");
    await assert.rejects(readProgress(res, () => {}, "失敗しました"), /整形に失敗しました：呼び出しが切れた/);
  });

  it("JSON 1 つの返事（入力の誤りなど）もそのまま読む", async () => {
    const bad = new Response(JSON.stringify({ error: "文字起こしが空です" }), { status: 400, headers: { "content-type": "application/json" } });
    await assert.rejects(readProgress(bad, () => {}, "失敗しました"), /文字起こしが空です/);
    const ok = new Response(JSON.stringify({ v: 1 }), { headers: { "content-type": "application/json" } });
    assert.deepEqual(await readProgress(ok, () => {}, "失敗しました"), { v: 1 });
  });

  it("途中で切れた行や、JSON でない返事は、生の構文エラーを出さない", async () => {
    const cut = new Response('{"type":"progress","stage":"0a"}\n{"type":"res', { headers: { "content-type": "application/x-ndjson" } });
    await assert.rejects(readProgress(cut, () => {}, "整形に失敗しました"), (e: Error) => e.message === "整形に失敗しました（返事が途中で切れました）");
    const html = new Response("<html>Gateway Timeout</html>", { status: 504, headers: { "content-type": "text/html" } });
    await assert.rejects(readProgress(html, () => {}, "整形に失敗しました"), (e: Error) => e.message === "整形に失敗しました（504。返事を読めませんでした）");
  });

  it("画面が進み具合を求めたときだけ、この形で返す", () => {
    assert.equal(wantsProgress(new Request("http://x/", { headers: { accept: "application/x-ndjson" } })), true);
    assert.equal(wantsProgress(new Request("http://x/")), false);
  });
});
