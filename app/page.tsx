"use client";

// 画面 1：面談内容を入力する。文字起こしを貼り、相手の呼び名を選び、整形（工程 0）の結果を本人が確かめて直す。
// 確かめる所（確からしさが低い発話、0b で直した所、相手が 2 人以上と推定した所）を先に出し、全文は畳んで後ろに置く。

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

/** 整形の結果が変わったときに消す、後の工程のデータ */
const cleared: Pick<SessionData, "analysis" | "selfScore" | "selfNote" | "answers" | "candidates" | "spark" | "sparkSkipped" | "followUp"> = {
  analysis: null,
  selfScore: null,
  selfNote: "",
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

  if (session === undefined) return <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-stone-600">読み込んでいます…</main>;

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
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold">1. 面談内容を入力する</h1>
      <p className="mt-1 text-sm text-stone-600">
        面談の文字起こしを貼ります。iPhone や Mac のボイスメモの文字起こし（話者の無い文）でかまいません。Claude が発話に区切って話者を付け、あなたが確かめて直します。
      </p>

      <section className="mt-5 space-y-3 rounded border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-stone-600">場面の種類</span>
            <select value={kind} onChange={(e) => setInput({ kind: e.target.value as MeetingKind })} className="mt-1 rounded border border-stone-300 px-2 py-1">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-stone-600">相手の呼び名（記録を相手ごとにつなぐ札）</span>
            <input value={otherName} onChange={(e) => setInput({ otherName: e.target.value })} placeholder="例：Aさん" className="mt-1 rounded border border-stone-300 px-2 py-1" />
          </label>
          <button type="button" onClick={loadDemo} className="ml-auto rounded border border-sky-700 px-3 py-1 text-sm text-sky-800 hover:bg-sky-50">
            サンプルを選ぶ（Demo Mode）
          </button>
        </div>
        <label className="block text-sm">
          <span className="text-stone-600">文字起こし</span>
          <textarea
            value={raw}
            onChange={(e) => setInput({ raw: e.target.value })}
            rows={8}
            placeholder="ここに貼る。実在の人の名前が入っていないかを確かめてください。"
            className="mt-1 w-full rounded border border-stone-300 p-2 font-mono text-sm"
          />
        </label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={format} disabled={busy || raw.trim() === ""} className="rounded bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "整形しています…" : "整形する（発話に区切って話者を付ける）"}
          </button>
          <span className="text-xs text-stone-500">{[...raw].length} 字</span>
          {busy && (
            <span className="text-xs text-stone-600" aria-live="polite">
              {elapsed < 5 ? "読んでいます" : "発話に区切って話者を付けています"}（{elapsed} 秒）
            </span>
          )}
        </div>
        {busy && <WaitNote time="1 分ほど" reopen="開き直して、もう一度「整形する」を押してください。貼った文字起こしは残っています。" />}
        {error && <p className="text-sm text-red-700">{error}　もう一度「整形する」を押すと、やり直せます。</p>}
      </section>

      {transcript && (
        <section className="mt-6">
          {mock && (
            <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              API キーが無いので、仮の出力です。話者は文の区切りだけで交互に付けてあり、本物の整形ではありません。
            </p>
          )}
          <h2 className="text-lg font-bold">
            確かめる所（{toCheckCount} 件）{ms !== null && <span className="ml-2 text-xs font-normal text-stone-500">整形 {Math.round(ms / 100) / 10} 秒</span>}
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            話者と区切りで Claude が迷った所と、意味が通らず推測を付けた所を、一つずつ出します。その下に、Claude が聞き違いを直した所の一覧があります。何もしなければ、Claude が直した後の本文で読みます。元の文はいつも残します。
          </p>
          {checkCount === 0 && <p className="mt-2 text-sm text-stone-700">0 件です。0 件は、聞き違いが無いことの証明ではありません。全文も一度は目を通してください。</p>}
          {transcript.step0c === null && <p className="mt-1 text-xs text-stone-500">意味が通らない所の推測は別に読んでいます。届いたら発話に添えます（分析には使いません）。</p>}
          {groups && <CheckGroups t={transcript} groups={groups} onChange={update} onSplit={split} className="mt-3" />}
          <Collapsible label={`全文（${transcript.utterances.length} 発話）を開く`} openLabel="全文を閉じる" className="mt-4">
            <div className="space-y-2">
              {transcript.utterances.map((u) => (
                <CheckUtterance key={u.index} t={transcript} u={u} onChange={update} onSplit={split} />
              ))}
            </div>
          </Collapsible>
          <div className="mt-6 flex items-center gap-3">
            <button type="button" onClick={goNext} className="rounded bg-sky-800 px-4 py-2 text-sm text-white">
              確かめた。フィードバックを読む →
            </button>
            <span className="text-xs text-stone-500">次の画面では、先に自分の点と一言を付けてから読みます。</span>
          </div>
        </section>
      )}
    </main>
  );
}

