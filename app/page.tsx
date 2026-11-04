"use client";

// 画面 1：面談内容を入力する。文字起こしを貼り、相手の呼び名を選び、整形（工程 0）の結果を本人が確かめて直す。
// 確かめる所（確からしさが低い発話、0b で直した所、相手が 2 人以上と推定した所）を先に出し、全文は畳んで後ろに置く。

import { useRouter } from "next/navigation";
import { useState } from "react";

import { splitUtterance } from "@/engine/transcript-edit.mts";
import type { MeetingKind, Utterance } from "@/engine/types.mts";
import type { Step0Response } from "@/engine/server.mts";
import { CheckUtterance } from "@/app/components/CheckUtterance";
import { Collapsible } from "@/app/components/Collapsible";
import { newSession, updateSession, useSession } from "@/app/lib/session";
import type { SessionData } from "@/app/lib/session";

const KINDS: { value: MeetingKind; label: string }[] = [
  { value: "生徒", label: "生徒面談" },
  { value: "保護者", label: "保護者面談" },
  { value: "コーチング", label: "コーチング（1on1）" },
];

/** 確かめる所：確からしさが低い、直した、相手が 2 人以上、当て直せなかった、本人が直した */
function needsCheck(u: Utterance): boolean {
  return u.check.some((c) => !c.startsWith("話者の確からしさが中"));
}

export default function Screen1() {
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session === undefined) return <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-stone-600">読み込んでいます…</main>;

  const kind = session?.kind ?? "生徒";
  const otherName = session?.otherName ?? "";
  const raw = session?.raw ?? "";
  const transcript = session?.transcript ?? null;
  const mock = session?.mock ?? false;
  const ms = session?.step0Ms ?? null;

  const setInput = (patch: Partial<Pick<SessionData, "kind" | "otherName" | "raw">>) =>
    updateSession((s) => ({ ...s, ...patch, transcript: null, analysis: null, selfScore: null, selfNote: "" }));

  const loadDemo = async () => {
    setError(null);
    const r = await fetch("/api/demo");
    const d = (await r.json()) as { kind: MeetingKind; otherName: string; raw: string };
    updateSession(() => newSession(d.kind, d.otherName, d.raw));
  };

  const format = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/step0", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw, kind }) });
      const d = (await r.json()) as Step0Response & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `整形に失敗しました（${r.status}）`);
      updateSession((s) => ({ ...s, kind, otherName, raw, transcript: d.transcript, mock: d.mock, step0Ms: d.ms, analysis: null, selfScore: null, selfNote: "" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const update = (next: Utterance) => {
    updateSession((s) => (s.transcript ? { ...s, transcript: { ...s.transcript, utterances: s.transcript.utterances.map((u) => (u.index === next.index ? next : u)) } } : s));
  };

  const split = (u: Utterance, pos: number) => {
    updateSession((s) => (s.transcript ? { ...s, transcript: splitUtterance(s.transcript, u.index, pos) } : s));
  };

  const goNext = () => {
    if (!transcript) return;
    updateSession((s) => ({ ...s, analysis: null, selfScore: null, selfNote: "" }));
    router.push("/reflection");
  };

  const toCheck = transcript ? transcript.utterances.filter(needsCheck) : [];

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
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </section>

      {transcript && (
        <section className="mt-6">
          {mock && (
            <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              API キーが無いので、仮の出力です。話者は文の区切りだけで交互に付けてあり、本物の整形ではありません。
            </p>
          )}
          <h2 className="text-lg font-bold">
            確かめる所（{toCheck.length} 件）{ms !== null && <span className="ml-2 text-xs font-normal text-stone-500">整形 {Math.round(ms / 100) / 10} 秒</span>}
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            話者の確からしさが低い発話、聞き違いを直した所、区切りが分からない所、相手が 2 人以上と推定した所を先に出します。話者は押して入れ替え、本文は「本文を直す」で直せます。区切りが分からない所は「本文を直す」を開き、カーソルの位置で分けられます。元の文はいつも残します。
          </p>
          {toCheck.length === 0 && <p className="mt-2 text-sm text-stone-700">0 件です。0 件は、聞き違いが無いことの証明ではありません。全文も一度は目を通してください。</p>}
          <div className="mt-3 space-y-2">
            {toCheck.map((u) => (
              <CheckUtterance key={u.index} t={transcript} u={u} onChange={update} onSplit={split} />
            ))}
          </div>
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
