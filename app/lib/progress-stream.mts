// 待つ間の進み具合を、サーバーから画面へ 1 行 1 件（NDJSON）で届ける。
// 行の種類：{ type: "progress", ... }（engine/progress.mts の ProgressEvent）、{ type: "result", data }、{ type: "error", error }。
// 画面が「accept: application/x-ndjson」を付けて呼んだときだけこの形で返す。付けなければ、今までどおり JSON を 1 つ返す。

import type { OnProgress, ProgressEvent } from "../../engine/progress.mts";

export const NDJSON = "application/x-ndjson";

type Line<T> = ({ type: "progress" } & ProgressEvent) | { type: "result"; data: T } | { type: "error"; error: string };

export function wantsProgress(req: Request): boolean {
  return (req.headers.get("accept") ?? "").includes(NDJSON);
}

/** run を回し、進み具合を 1 行ずつ流し、最後に結果か失敗を 1 行流す */
export function progressResponse<T>(run: (onProgress: OnProgress) => Promise<T>, errorPrefix = ""): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 画面が閉じられた後は流せない。呼び出しは止めず、流すのだけやめる
      let open = true;
      const send = (line: Line<T>) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const data = await run((e) => send({ type: "progress", ...e }));
        send({ type: "result", data });
      } catch (e) {
        send({ type: "error", error: `${errorPrefix}${(e as Error).message}` });
      }
      try {
        controller.close();
      } catch {
        // すでに閉じている
      }
    },
  });
  return new Response(body, { headers: { "content-type": `${NDJSON}; charset=utf-8`, "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}

/** 返事を読む。NDJSON なら進み具合を onProgress に渡し、結果を返す。JSON 1 つ（入力の誤りなど）もそのまま読む */
export async function readProgress<T>(r: Response, onProgress: OnProgress, fallback: string): Promise<T> {
  if (!(r.headers.get("content-type") ?? "").includes(NDJSON) || !r.body) {
    let d: T & { error?: string };
    try {
      d = (await r.json()) as T & { error?: string };
    } catch {
      throw new Error(`${fallback}（${r.status}。返事を読めませんでした）`);
    }
    if (!r.ok || d.error) throw new Error(d.error ?? `${fallback}（${r.status}）`);
    return d;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: { data: T } | null = null;
  const take = (text: string) => {
    if (text.trim() === "") return;
    let line: Line<T>;
    try {
      line = JSON.parse(text) as Line<T>;
    } catch {
      throw new Error(`${fallback}（返事が途中で切れました）`);
    }
    if (line.type === "error") throw new Error(line.error);
    if (line.type === "result") result = { data: line.data };
    else {
      const { type: _type, ...e } = line;
      void _type;
      onProgress(e);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) !== -1) {
      take(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
    if (done) break;
  }
  take(buf + dec.decode());
  const got = result as { data: T } | null;
  if (!got) throw new Error(`${fallback}（返事が途中で切れました）`);
  return got.data;
}

/** 進み具合つきで POST する */
export async function postWithProgress<T>(url: string, payload: unknown, onProgress: OnProgress, fallback: string): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: NDJSON }, body: JSON.stringify(payload) });
  return readProgress<T>(r, onProgress, fallback);
}
