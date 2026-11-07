"use client";

// AI を待つ間の進み具合（画面 1・2・4・5）。段階を縦に並べ、済んだ段階はチェック、今の段階に帯を出す。
// 帯と ％ は、サーバーから届いた本当の量だけで動かす（engine/progress.mts）。量が数えられない段階は、
// 進んだ割合を作らず、帯も出さない（帯が出たら進む、と読めるように）。文の後ろで点を順に光らせ、動いていることだけを示す。
// 経過の秒は、この部品が出ている間を数える。

import { useEffect, useState } from "react";

import type { ProgressEvent } from "@/engine/progress.mts";
import { WaitNote } from "./WaitNote";
import { H2 } from "./ui";

export type WaitView = {
  /** 今の段階（0 始まり） */
  current: number;
  /** 今していること */
  status: string;
  /** 0〜1。数えられないときは null */
  ratio: number | null;
  /** 帯の右下に出す全体の量（「全 3,212 字」など） */
  whole?: string;
};

function useElapsed(): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const timer = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return sec;
}

const clock = (sec: number) => (sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`);

/** 進んだ割合の帯。量が数えられる段階だけに出す */
function Bar({ ratio }: { ratio: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 量が数えられない段階の印。3 つの点が順に光る（進んだ割合は作らない） */
function Dots() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-wait-dot rounded-full bg-accent motion-reduce:animate-none motion-reduce:opacity-50" style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </span>
  );
}

function Percent({ ratio }: { ratio: number }) {
  return (
    <span className="shrink-0 leading-none tabular-nums" aria-hidden="true">
      <span className="text-[1.9rem] font-semibold tracking-tight">{Math.round(Math.min(1, Math.max(0, ratio)) * 100)}</span>
      <span className="ml-0.5 text-[0.86rem] text-ink-2">%</span>
    </span>
  );
}

function Detail({ view }: { view: WaitView }) {
  return (
    <>
      {view.ratio !== null && (
        <div className="mt-3">
          <Bar ratio={view.ratio} />
        </div>
      )}
      <p className={`${view.ratio !== null ? "mt-2" : "mt-1"} flex flex-wrap justify-between gap-x-4 text-[0.86rem] leading-[1.7] text-ink-2`}>
        <span>
          <span aria-live="polite">{view.status}</span>
          {view.ratio === null && <Dots />}
        </span>
        {view.whole && <span className="tabular-nums text-ink-3">{view.whole}</span>}
      </p>
    </>
  );
}

export function WaitPanel({ title, estimate, steps = [], view, className = "" }: { title: string; estimate: string; steps?: string[]; view: WaitView; className?: string }) {
  const elapsed = useElapsed();
  return (
    <div className={`rounded-md border border-line bg-surface px-5 py-5 sm:px-7 sm:py-6 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className={H2}>{title}</p>
        <p className="text-[0.86rem] tabular-nums text-ink-3">
          <span aria-hidden="true">{clock(elapsed)}</span>
          <span className="mx-2 text-line-2" aria-hidden="true">
            ／
          </span>
          目安 <span className="text-[1.02rem] font-semibold text-ink">{estimate}</span>
        </p>
      </div>

      {steps.length > 0 ? (
        <ol className="mt-6">
          {steps.map((label, i) => {
            const now = i === view.current;
            const done = i < view.current;
            return (
              <li key={label} className="relative flex gap-4 pb-6 last:pb-0">
                {i < steps.length - 1 && <span className="absolute bottom-1 left-[13px] top-9 w-px bg-line-2" aria-hidden="true" />}
                <span
                  className={`relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums ${
                    now ? "border-accent bg-accent font-semibold text-white" : done ? "border-accent text-accent" : "border-line-2 bg-surface text-ink-3"
                  }`}
                >
                  {done ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2.5 6.5 5 9l4.5-5.5" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                  {now && <span className="absolute -inset-[5px] animate-spin rounded-full border-2 border-transparent border-t-accent motion-reduce:animate-none" aria-hidden="true" />}
                </span>
                <div className="min-w-0 grow">
                  <div className="flex min-h-8 items-center justify-between gap-4">
                    <p className={now ? "font-semibold" : done ? "text-ink-2" : "text-ink-3"}>{label}</p>
                    {done && <span className="text-xs text-ink-3">済</span>}
                    {now && view.ratio !== null && <Percent ratio={view.ratio} />}
                  </div>
                  {now && <Detail view={view} />}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-2">
          <Detail view={view} />
        </div>
      )}

      <div className="mt-5">
        <WaitNote />
      </div>
    </div>
  );
}

const num = (n: number) => n.toLocaleString("ja-JP");

/** 整形（工程 0。画面 1・5）の段階と、届いた進み具合の見せ方 */
export const STEP0_STEPS = ["発言に区切り、話者を付ける", "聞き違いを直す所を挙げる"];
export function step0View(e: ProgressEvent | null): WaitView {
  if (e?.stage === "0b") return { current: 1, status: "区切った発言を読み、聞き違いを探しています", ratio: null };
  if (e?.total && e.done) {
    const what = e.unit === "文" ? "まで話者を付けました" : "まで区切りました";
    return { current: 0, status: `${num(e.done)} ${e.unit ?? ""}${what}`, ratio: e.done / e.total, whole: `全 ${num(e.total)} ${e.unit ?? ""}` };
  }
  return { current: 0, status: "文字起こしを読んでいます", ratio: null };
}

/** 分析（工程 1・2。画面 2）の段階と、届いた進み具合の見せ方 */
export const ANALYZE_STEPS = ["場面を選び、やりとりを読む", "項目ごとに点を付ける"];
export function analyzeView(e: ProgressEvent | null): WaitView {
  if (e?.stage === "2") {
    if (e.total && e.done) return { current: 1, status: `${e.done} 項目を終えました`, ratio: e.done / e.total, whole: `全 ${e.total} 項目` };
    return { current: 1, status: "選んだ場面と面談の全体を、採点表の項目に照らしています", ratio: null };
  }
  const status = ["面談の全体を読んでいます", "場面 1 の引用と問いを書いています", "場面 2 の引用と問いを書いています", "振り返りの要点を書いています"][e?.done ?? 0] ?? "面談の全体を読んでいます";
  return { current: 0, status, ratio: null };
}
