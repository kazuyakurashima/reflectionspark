import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { recordInterview, runDream } from "./recorder.mts";

type Sent = { type: string }[];

/** 記録係のセッションの偽物。stream は events を流したあと、hang なら止められるまで待つ */
function fakeSessions(opts: { events?: unknown[]; hang?: boolean; interruptFails?: boolean; retrieveFails?: boolean }) {
  const sent: Sent = [];
  const created: string[] = [];
  const client = {
    beta: {
      sessions: {
        create: async () => ({ id: "session-1" }),
        retrieve: async () => {
          if (opts.retrieveFails) throw new Error("読めない");
          return { status: "idle", usage: { input_tokens: 10, output_tokens: 5 } };
        },
        events: {
          send: async (_id: string, p: { events: Sent }) => {
            if (opts.interruptFails && p.events[0].type === "user.interrupt") throw new Error("送れない");
            sent.push(...p.events);
          },
          stream: async () => {
            const controller = new AbortController();
            return {
              controller,
              async *[Symbol.asyncIterator]() {
                for (const e of opts.events ?? []) yield e;
                if (opts.hang) {
                  await new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("止めた"))));
                }
              },
            };
          },
        },
      },
    },
  };
  const run = (timeoutMs = 5) =>
    recordInterview(client as unknown as Anthropic, {
      resources: { environmentId: "e", agentId: "a", agentVersion: 1, storeId: "s" },
      interviewId: "a-1",
      date: "2025-10-24",
      markdown: "# 記録\n",
      indexLineText: "- records/a-1.md｜1 本目",
      title: "テスト",
      budgetMinor: "10",
      timeoutMs,
      onCreated: (id) => created.push(id),
    });
  return { run, sent, created };
}

describe("記録係のセッションの止め方", () => {
  test("止まるのを見てから抜けたら、止める要求は送らない", async () => {
    const f = fakeSessions({ events: [{ type: "agent.tool_use", name: "write" }, { type: "session.status_idle", stop_reason: { type: "end_turn" } }] });
    const r = await f.run();
    assert.equal(r.interruptRequested, false);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stopReason, "end_turn");
    assert.deepEqual(f.sent.map((e) => e.type), ["user.message"]);
    assert.deepEqual(f.created, ["session-1"]);
  });

  test("時間切れなら、受信を止めるだけで終わらず、止める要求を送る", async () => {
    const f = fakeSessions({ events: [{ type: "agent.tool_use", name: "write" }], hang: true });
    const r = await f.run();
    assert.equal(r.interruptRequested, true);
    assert.deepEqual(f.sent.map((e) => e.type), ["user.message", "user.interrupt"]);
    assert.equal(r.errors.some((e) => e.includes("時間切れ")), true);
  });

  test("流れが止まるのを見ずに終わっても、止める要求を送る。要求の失敗と状態の読み取りの失敗は投げずに残す", async () => {
    const quiet = fakeSessions({ events: [] });
    assert.equal((await quiet.run()).interruptRequested, true);
    const bad = fakeSessions({ hang: true, interruptFails: true, retrieveFails: true });
    const r = await bad.run();
    assert.equal(r.interruptRequested, false);
    assert.equal(r.errors.some((e) => e.includes("止める要求を送れませんでした")), true);
    assert.equal(r.errors.some((e) => e.includes("状態を読めませんでした")), true);
    assert.equal(r.sessionId, "session-1");
  });
});

/** 夢の偽物。retrieve は steps を順に返す（Error なら投げる）。最後の 1 つを繰り返す */
function fakeDream(steps: (unknown | Error)[], cancelFailures = 0) {
  let i = 0;
  let cancels = 0;
  const client = {
    beta: {
      dreams: {
        create: async () => ({ id: "dream-1", status: "pending", usage: {}, outputs: [], session_id: null, error: null }),
        retrieve: async () => {
          const s = steps[Math.min(i++, steps.length - 1)];
          if (s instanceof Error) throw s;
          return s;
        },
        cancel: async () => {
          cancels++;
          if (cancels <= cancelFailures) throw new Error("取り消せない");
        },
      },
    },
  };
  const run = (over: Partial<Parameters<typeof runDream>[1]> = {}) => runDream(client as unknown as Anthropic, { storeId: "s", sessionIds: ["x"], instructions: "i", capInputEquivalent: 100, pollMs: 1, ...over });
  return { run, cancels: () => cancels };
}

const step = (status: string, input: number) => ({ id: "dream-1", status, usage: { input_tokens: input, output_tokens: 0 }, outputs: [{ memory_store_id: "out" }], session_id: "ds", error: null });

describe("夢の見張り（取り消しは超えたあとなので、厳密な上限ではない）", () => {
  test("上限の内なら、取り消さずに終わるのを待つ", async () => {
    const f = fakeDream([step("running", 50), step("completed", 80)]);
    const r = await f.run();
    assert.deepEqual([r.status, r.stoppedBy, r.canceledByCap, r.watchEndedBeforeTerminal, f.cancels()], ["completed", null, false, false, 0]);
  });

  test("上限を超えたら取り消しを 1 回だけ頼み、終わるのを待つ。超えた量が見える", async () => {
    const f = fakeDream([step("running", 150), step("running", 180), step("canceled", 200)]);
    const r = await f.run();
    assert.deepEqual([r.status, r.stoppedBy, r.canceledByCap, r.cancelRequested, f.cancels()], ["canceled", "cap", true, true, 1]);
    assert.equal(r.inputEquivalent, 200);
    assert.equal(r.capInputEquivalent, 100);
  });

  test("状態を 1 回読めなくても続ける。続けて読めなければ、取り消しを頼んで見張りをやめる", async () => {
    const recover = fakeDream([new Error("通信"), step("completed", 50)]);
    const a = await recover.run();
    assert.deepEqual([a.status, a.monitorErrors, a.stoppedBy, recover.cancels()], ["completed", 1, null, 0]);
    const lost = fakeDream([new Error("通信"), new Error("通信"), new Error("通信")]);
    const b = await lost.run({ maxMonitorErrors: 3 });
    assert.deepEqual([b.stoppedBy, b.cancelRequested, b.watchEndedBeforeTerminal, b.monitorErrors, lost.cancels()], ["monitor-error", true, true, 3, 1]);
    assert.equal(b.lastMonitorError, "通信");
  });

  test("取り消しの要求が失敗したら次の見張りで頼み直す。止まらなければ待つのをやめ、終わっていないと分かる形で返す", async () => {
    const retry = fakeDream([step("running", 150), step("running", 160), step("canceled", 170)], 1);
    const a = await retry.run();
    assert.deepEqual([a.status, a.cancelRequested, a.cancelError, retry.cancels()], ["canceled", true, null, 2]);
    const stuck = fakeDream([step("running", 150)]);
    const b = await stuck.run({ cancelGraceMs: 5 });
    assert.deepEqual([b.status, b.stoppedBy, b.watchEndedBeforeTerminal, stuck.cancels()], ["running", "cap", true, 1]);
  });

  test("時間切れでも取り消す", async () => {
    const f = fakeDream([step("running", 50), step("canceled", 60)]);
    const r = await f.run({ timeoutMs: 0 });
    assert.deepEqual([r.status, r.stoppedBy, r.canceledByCap], ["canceled", "time", false]);
  });
});
