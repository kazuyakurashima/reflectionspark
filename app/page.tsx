"use client";

// 画面 1：面談内容を入力する。文字起こしを貼り、相手の呼び名を選び、整形（工程 0）の結果を本人が確かめて直す。
// 確かめる所（確からしさが低い発話、0b で直した所、相手が 2 人以上と推定した所）を先に出し、全文は畳んで後ろに置く。
// 見た目は画面 2 と同じ決まり（色は app/globals.css、会話は話者ごとの島）。次へのボタンは下に固定する。

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { splitUtterance } from "@/engine/transcript-edit.mts";
import type { MeetingKind, Utterance } from "@/engine/types.mts";
import type { Step0Response } from "@/engine/server.mts";
import { CheckGroups } from "@/app/components/CheckGroups";
import { CheckUtterance } from "@/app/components/CheckUtterance";
import { Collapsible } from "@/app/components/Collapsible";
import { WaitNote } from "@/app/components/WaitNote";
import { countChecks, countToCheck, groupChecks } from "@/app/lib/check-groups.mts";
import { fetchStep0c, newSession, updateSession, useSession } from "@/app/lib/session";
import type { SessionData } from "@/app/lib/session";

const KINDS: { value: MeetingKind; label: string }[] = [
  { value: "生徒", label: "生徒面談" },
  { value: "保護者", label: "保護者面談" },
  { value: "コーチング", label: "コーチング（1on1）" },
];

const PAGE = "mx-auto max-w-3xl px-4 text-base leading-[1.85] md:text-[1.0625rem]";
const PRIMARY = "inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-accent px-6 py-2.5 font-semibold text-white hover:bg-accent/90 disabled:bg-line-2 disabled:text-ink-3";
const SECONDARY = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface px-5 text-[0.95rem] hover:border-ink-2 disabled:opacity-40";
const LABEL = "block text-[0.86rem] text-ink-2";

/** 整形の結果が変わったときに消す、後の工程のデータ */
const cleared: Pick<SessionData, "analysis" | "selfScore" | "selfNote" | "ownViews" | "answers" | "candidates" | "spark" | "sparkSkipped" | "followUp"> = {
  analysis: null,
  selfScore: null,
  selfNote: "",
  ownViews: [],
  answers: [],
  candidates: null,
  spark: null,
  sparkSkipped: false,
  followUp: null,
};

export default function Screen1() {
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 整形を始めた時刻と、待つ間の経過の秒（進み具合を出す。0a は 1 分前後かかることがある） */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const elapsed = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));

  if (session === undefined) return <main className={`${PAGE} py-8 text-sm text-ink-2`}>読み込んでいます…</main>;

  const kind = session?.kind ?? "生徒";
  const otherName = session?.otherName ?? "";
  const raw = session?.raw ?? "";
  const transcript = session?.transcript ?? null;
  const mock = session?.mock ?? false;
  const ms = session?.step0Ms ?? null;

  /** 入力（文字起こし・場面の種類）を変えたら、整形の結果と、その後の答え・候補・Spark・追跡をすべて消す。呼び名は札なので消さない */
  const setInput = (patch: Partial<Pick<SessionData, "kind" | "otherName" | "raw">>) =>
    updateSession((s) => (patch.raw !== undefined || patch.kind !== undefined ? { ...s, ...patch, ...cleared, transcript: null, mock: false, step0Ms: null } : { ...s, ...patch }));

  const loadDemo = async () => {
    setError(null);
    const r = await fetch("/api/demo");
    const d = (await r.json()) as { kind: MeetingKind; otherName: string; raw: string };
    updateSession(() => newSession(d.kind, d.otherName, d.raw));
  };

  const format = async () => {
    setBusy(true);
    setError(null);
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);
    try {
      const r = await fetch("/api/step0", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw, kind }) });
      const d = (await r.json()) as Step0Response & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `整形に失敗しました（${r.status}）`);
      updateSession((s) => ({ ...s, kind, otherName, raw, transcript: d.transcript, mock: d.mock, step0Ms: d.ms, ...cleared }));
      // 0c は別に回し、届いたら付ける（分析を待たせない）
      void fetchStep0c(d.transcript, (fn) => updateSession((s) => (s.transcript ? { ...s, transcript: fn(s.transcript) } : s)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStartedAt(null);
    }
  };

  /** 発話を直したら、分析と後の工程のデータを消す（引用が本文と合わなくなるため）。自分の点と一言は面談への自分の見方なので残す */
  const update = (next: Utterance) => {
    updateSession((s) =>
      s.transcript ? { ...s, ...cleared, selfScore: s.selfScore, selfNote: s.selfNote, transcript: { ...s.transcript, utterances: s.transcript.utterances.map((u) => (u.index === next.index ? next : u)) } } : s,
    );
  };

  const split = (u: Utterance, pos: number) => {
    updateSession((s) => (s.transcript ? { ...s, ...cleared, selfScore: s.selfScore, selfNote: s.selfNote, transcript: splitUtterance(s.transcript, u.index, pos) } : s));
  };

  const goNext = () => {
    if (!transcript) return;
    router.push("/reflection");
  };

  const groups = transcript ? groupChecks(transcript) : null;
  const checkCount = groups ? countChecks(groups) : 0;
  const toCheckCount = groups ? countToCheck(groups) : 0;

  return (
    <main className={PAGE}>
      <section className="pb-2 pt-6">
        <h1 className="text-[1.75rem] font-semibold leading-snug">面談内容を入力する</h1>
        <p className="mt-2 text-ink-2">
          面談の文字起こしを貼ります。iPhone や Mac のボイスメモの文字起こし（話者の無い文）でかまいません。Claude が発言に区切って話者を付け、あなたが確かめて直します。
        </p>
      </section>

      {raw.trim() === "" && (
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl bg-accent-soft px-5 py-4">
          <p className="min-w-0 grow basis-72 text-[0.95rem] leading-[1.7]">
            <span className="font-semibold">手元に文字起こしが無くても試せます。</span>
            ダミーの面談のサンプルで、1 から 5 まで通せます（ログイン不要）。
          </p>
          <button type="button" onClick={loadDemo} className="min-h-11 shrink-0 rounded-full border border-accent bg-surface px-5 text-[0.95rem] font-semibold text-accent hover:bg-white">
            サンプルを選ぶ（Demo Mode）
          </button>
        </div>
      )}

      <section className="mt-8 space-y-6">
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          <div>
            <p className={LABEL} id="kind-label">
              場面の種類
            </p>
            <div className="mt-1.5 inline-flex flex-wrap rounded-full border border-line-2 bg-surface p-0.5 text-[0.92rem]" role="group" aria-labelledby="kind-label">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => kind !== k.value && setInput({ kind: k.value })}
                  aria-pressed={kind === k.value}
                  className={`min-h-10 rounded-full px-4 ${kind === k.value ? "bg-accent font-semibold text-white" : "text-ink-2 hover:text-ink"}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={LABEL}>
              相手の呼び名<span className="ml-2 text-ink-3">記録を相手ごとにつなぐ札</span>
            </span>
            <input
              value={otherName}
              onChange={(e) => setInput({ otherName: e.target.value })}
              placeholder="例：Aさん"
              className="mt-1.5 block min-h-11 w-56 rounded-lg border border-line-2 bg-surface px-3.5 text-[0.98rem] placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>文字起こし</span>
            <span className="text-xs tabular-nums text-ink-3">{[...raw].length} 字</span>
          </span>
          <textarea
            value={raw}
            onChange={(e) => setInput({ raw: e.target.value })}
            rows={transcript ? 5 : 10}
            placeholder="ここに貼る。実在の人の名前が入っていないかを確かめてください。"
            className="mt-1.5 block w-full rounded-xl border border-line-2 bg-surface px-4 py-3 text-[0.95rem] leading-[1.8] placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </label>

        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" onClick={format} disabled={busy || raw.trim() === ""} className={transcript ? SECONDARY : PRIMARY}>
              {busy ? "整形しています…" : transcript ? "もう一度整形する" : "整形する"}
            </button>
            {busy ? (
              <span className="text-[0.86rem] text-ink-2" aria-live="polite">
                {elapsed < 5 ? "読んでいます" : "発言に区切って話者を付けています"}（{elapsed} 秒）
              </span>
            ) : (
              <span className="text-[0.86rem] text-ink-2">
                {transcript ? "文字起こしを貼り替えたときに押します。" : "発言に区切って、話者を付けます（1 分ほど）。"}
                {raw.trim() !== "" && (
                  <button type="button" onClick={loadDemo} className="ml-3 text-ink-3 underline decoration-ink-3/40 underline-offset-[3px] hover:text-ink">
                    サンプルに入れ替える（Demo Mode）
                  </button>
                )}
              </span>
            )}
          </div>
          {busy && <WaitNote time="1 分ほど" reopen="開き直して、もう一度「整形する」を押してください。貼った文字起こしは残っています。" />}
          {error && <p className="mt-2 text-[0.92rem] text-red-700">{error}　もう一度「整形する」を押すと、やり直せます。</p>}
        </div>
      </section>

      {transcript && (
        <>
          <section className="mt-16">
            {mock && (
              <p className="mb-6 rounded-lg border border-line-2 bg-surface px-4 py-3 text-[0.92rem] leading-[1.7]">
                API キーが無いので、仮の出力です。話者は文の区切りだけで交互に付けてあり、本物の整形ではありません。
              </p>
            )}
            <h2 className="flex flex-wrap items-baseline gap-x-3 text-[1.35rem] font-semibold leading-snug">
              確かめる所
              <span className="text-base font-normal tabular-nums text-ink-2">{toCheckCount} 件</span>
              {ms !== null && <span className="text-xs font-normal tabular-nums text-ink-3">整形 {Math.round(ms / 100) / 10} 秒</span>}
            </h2>
            <p className="mt-2 text-[0.95rem] text-ink-2">
              話者と区切りで Claude が迷った所と、意味が通らず推測を付けた所を、一つずつ出します。その下に、Claude が聞き違いを直した所の一覧があります。何もしなければ、Claude が直した後の本文で読みます。元の文はいつも残します。
            </p>
            <p className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-3">
              <span>
                <span className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-[5px]">太字の下線</span>　Claude が直した後の言葉
              </span>
              <span>
                <span className="text-ink underline decoration-ink-3 decoration-wavy decoration-1 underline-offset-[5px]">波線</span>　直す前の言葉と、意味が通らないと見た所
              </span>
            </p>
            {checkCount === 0 && <p className="mt-4 text-[0.95rem]">0 件です。0 件は、聞き違いが無いことの証明ではありません。全文も一度は目を通してください。</p>}
            {transcript.step0c === null && <p className="mt-2 text-xs text-ink-3">意味が通らない所の推測は別に読んでいます。届いたら発言に添えます（分析には使いません）。</p>}
            {groups && <CheckGroups t={transcript} groups={groups} onChange={update} onSplit={split} className="mt-10" />}
          </section>

          <section className="mt-16">
            <h2 className="flex items-baseline gap-3 text-[1.35rem] font-semibold leading-snug">
              全文
              <span className="text-base font-normal tabular-nums text-ink-2">発言 {transcript.utterances.length} 回</span>
            </h2>
            <p className="mt-2 text-[0.95rem] text-ink-2">整形した後の面談の全部です。発言にマウスを載せると、「話者を替える」「本文を直す」が出ます（スマホではいつも出ています）。</p>
            <Collapsible label="全文を開く" openLabel="全文を閉じる" className="mt-3">
              <div className="mt-4 space-y-3">
                {transcript.utterances.map((u) => (
                  <CheckUtterance key={u.index} t={transcript} u={u} onChange={update} onSplit={split} />
                ))}
              </div>
            </Collapsible>
          </section>

          <div className="sticky bottom-0 z-10 -mx-4 mt-12 border-t border-line bg-paper/90 px-4 py-3 backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button type="button" onClick={goNext} className={PRIMARY}>
                次へ　2. フィードバックを読む
              </button>
              <span className="hidden text-[0.86rem] text-ink-2 sm:inline">次の画面で、AI が面談を読みます（1 分ほど）。</span>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
