"use client";

// 画面 5：次の面談で。続きの面談を貼る → 整形して確かめる → 先に「できた／一部／まだ／場面がなかった」と自分の点を付ける →
// そのあと AI の判定・根拠の引用・なぜの一文・項目ごとの点。本人の自己評価は API に渡さない（決まり 10）。
// 本人と AI の判定を並べ、ずれは確かめる点として出す。同じ行動を追うのが 3 回目なら、続けるか変えるかを聞く。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { FollowUpResponse, Step0Response } from "@/engine/server.mts";
import { splitUtterance } from "@/engine/transcript-edit.mts";
import type { FollowUpVerdict, Utterance } from "@/engine/types.mts";
import { CheckUtterance } from "@/app/components/CheckUtterance";
import { Collapsible } from "@/app/components/Collapsible";
import { ScoreTable } from "@/app/components/Scores";
import { UtteranceContext } from "@/app/components/UtteranceView";
import { fetchStep0c, newFollowUp, newSession, updateSession, useSession } from "@/app/lib/session";

const VERDICTS: FollowUpVerdict[] = ["できた", "一部", "まだ", "場面がなかった"];

export default function Screen5() {
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<FollowUpVerdict | null>(null);
  const [score, setScore] = useState("");
  const [openQuote, setOpenQuote] = useState<number | null>(null);
  const started = useRef(false);

  const spark = session?.spark ?? null;
  const fu = session?.followUp ?? null;
  const transcript = fu?.transcript ?? null;
  const result = fu?.result ?? null;

  useEffect(() => {
    // 追跡は自己評価と並行して始める。自己評価はこの呼び出しに入れない（決まり 10）
    if (!spark || !transcript || result || started.current) return;
    started.current = true;
    const payload = { transcript, spark: { sentence: spark.sentence, criterion: spark.criterion, previousScene: spark.previousScene } };
    (async () => {
      try {
        const r = await fetch("/api/followup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const d = (await r.json()) as FollowUpResponse & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `追跡に失敗しました（${r.status}）`);
        updateSession((s) => {
          const f = s.followUp ?? newFollowUp();
          const counted = f.countedSparkId === spark.id;
          return {
            ...s,
            followUp: { ...f, result: { step4: d.step4, mock: d.mock }, countedSparkId: spark.id },
            spark: s.spark && !counted ? { ...s.spark, timesFollowed: s.spark.timesFollowed + 1 } : s.spark,
          };
        });
      } catch (e) {
        setError((e as Error).message);
        started.current = false;
      }
    })();
  }, [spark, transcript, result]);

  if (session === undefined) return <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-stone-600">読み込んでいます…</main>;
  if (!session || (!spark && !session.sparkSkipped)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <p className="text-sm">先に画面 4 で「次に試すひとつ」を決めてください。</p>
        <Link href="/spark" className="text-sm text-sky-800 underline">
          画面 4 へ
        </Link>
      </main>
    );
  }
  if (!spark) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-bold">5. 次の面談で</h1>
        <p className="mt-2 text-sm">前回は行動を見送ったので、追うものがありません。次の面談は画面 1 から新しく始めてください。</p>
        <Link href="/" className="text-sm text-sky-800 underline">
          画面 1 へ
        </Link>
      </main>
    );
  }

  const raw = fu?.raw ?? "";
  const kind = session.kind;
  const setRaw = (v: string) => updateSession((s) => ({ ...s, followUp: { ...(s.followUp ?? newFollowUp()), raw: v, transcript: null, result: null, selfVerdict: null, selfScore: null } }));
  const loadDemo = async () => {
    const r = await fetch("/api/demo/2");
    const d = (await r.json()) as { raw: string };
    setRaw(d.raw);
  };
  const format = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/step0", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw, kind }) });
      const d = (await r.json()) as Step0Response & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `整形に失敗しました（${r.status}）`);
      started.current = false;
      updateSession((s) => ({ ...s, followUp: { ...(s.followUp ?? newFollowUp()), raw, transcript: d.transcript, mock: d.mock, step0Ms: d.ms, result: null, selfVerdict: null, selfScore: null } }));
      void fetchStep0c(d.transcript, (fn) => updateSession((s) => (s.followUp?.transcript ? { ...s, followUp: { ...s.followUp, transcript: fn(s.followUp.transcript) } } : s)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const update = (next: Utterance) =>
    updateSession((s) =>
      s.followUp?.transcript ? { ...s, followUp: { ...s.followUp, transcript: { ...s.followUp.transcript, utterances: s.followUp.transcript.utterances.map((u) => (u.index === next.index ? next : u)) } } } : s,
    );
  const split = (u: Utterance, pos: number) =>
    updateSession((s) => (s.followUp?.transcript ? { ...s, followUp: { ...s.followUp, transcript: splitUtterance(s.followUp.transcript, u.index, pos) } } : s));
  const submitSelf = () => {
    const n = Number(score);
    if (!verdict || !Number.isInteger(n) || n < 1 || n > 10) return;
    updateSession((s) => ({ ...s, followUp: { ...(s.followUp ?? newFollowUp()), selfVerdict: verdict, selfScore: n } }));
  };
  const selfDone = fu?.selfVerdict !== null && fu?.selfVerdict !== undefined;
  const toCheck = transcript ? transcript.utterances.filter((u) => u.check.some((c) => !c.startsWith("話者の確からしさが中"))) : [];
  const third = spark.timesFollowed >= 3 && !spark.keepAfterThird;
  const keep = () => updateSession((s) => ({ ...s, spark: s.spark ? { ...s.spark, keepAfterThird: true } : s.spark }));
  const change = () => {
    // 今回の面談を新しい面談として画面 2 から始め、別の行動を選び直す
    if (!transcript) return;
    updateSession((s) => ({ ...newSession(s.kind, s.otherName, raw), firstMeeting: false, transcript, mock: fu?.mock ?? false, step0Ms: fu?.step0Ms ?? null }));
    router.push("/reflection");
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold">5. 次の面談で</h1>
      <p className="mt-1 text-sm text-stone-600">続きの面談を貼ります。先に自分で「できた／一部／まだ／場面がなかった」と点を付け、そのあと AI の判定を読みます。自己評価は AI に渡しません。</p>

      <section className="mt-4 rounded border-2 border-amber-400 bg-amber-50 p-4">
        <p className="text-xs text-amber-900">前回決めた、次に試すひとつ（{spark.timesFollowed} 回追った）</p>
        <p className="mt-1 font-semibold">{spark.sentence}</p>
        {spark.criterion && <p className="mt-1 text-sm text-stone-700">できたかの基準：{spark.criterion}</p>}
      </section>

      <section className="mt-5 space-y-3 rounded border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-stone-600">続きの面談の文字起こし</span>
          <button type="button" onClick={loadDemo} className="ml-auto rounded border border-sky-700 px-3 py-1 text-sm text-sky-800 hover:bg-sky-50">
            サンプルの続きを選ぶ（Demo Mode）
          </button>
        </div>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={6} placeholder="ここに貼る" className="w-full rounded border border-stone-300 p-2 font-mono text-sm" aria-label="続きの面談の文字起こし" />
        <div className="flex items-center gap-3">
          <button type="button" onClick={format} disabled={busy || raw.trim() === ""} className="rounded bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "整形しています…" : "整形する"}
          </button>
          <span className="text-xs text-stone-500">{[...raw].length} 字</span>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </section>

      {transcript && (
        <>
          <section className="mt-5">
            {fu?.mock && <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">API キーが無いので、整形は仮の出力です。</p>}
            <Collapsible label={`確かめる所（${toCheck.length} 件）を開く`} openLabel="確かめる所を閉じる">
              <div className="space-y-2">
                {toCheck.map((u) => (
                  <CheckUtterance key={u.index} t={transcript} u={u} onChange={update} onSplit={split} />
                ))}
                {toCheck.length === 0 && <p className="text-sm text-stone-700">0 件です。0 件は、聞き違いが無いことの証明ではありません。</p>}
              </div>
            </Collapsible>
            <Collapsible label={`全文（${transcript.utterances.length} 発話）を開く`} openLabel="全文を閉じる" className="mt-2">
              <div className="space-y-2">
                {transcript.utterances.map((u) => (
                  <CheckUtterance key={u.index} t={transcript} u={u} onChange={update} onSplit={split} />
                ))}
              </div>
            </Collapsible>
          </section>

          <section className="mt-5 rounded border border-stone-200 bg-white p-4">
            <h2 className="font-bold">自分の評価（先に付ける。AI に渡さない）</h2>
            {selfDone ? (
              <p className="mt-2 text-sm">
                自分の判定：<span className="font-semibold">{fu?.selfVerdict}</span>　自分の点：<span className="font-semibold">{fu?.selfScore}／10</span>
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {VERDICTS.map((v) => (
                    <label key={v} className={`cursor-pointer rounded border px-3 py-1 text-sm ${verdict === v ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300"}`}>
                      <input type="radio" name="verdict" value={v} checked={verdict === v} onChange={() => setVerdict(v)} className="sr-only" />
                      {v}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="block text-stone-600">この面談の点（10 点満点）</span>
                    <input type="number" min={1} max={10} value={score} onChange={(e) => setScore(e.target.value)} className="mt-1 w-24 rounded border border-stone-300 px-2 py-1" />
                  </label>
                  <button type="button" onClick={submitSelf} disabled={!verdict || !(Number(score) >= 1 && Number(score) <= 10)} className="rounded bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-40">
                    付けた。AI の判定を見る
                  </button>
                </div>
              </div>
            )}
          </section>

          {!selfDone ? (
            <p className="mt-4 text-sm text-stone-500">自分の評価を付けると、AI の判定が開きます。{result ? "（判定は届いています）" : "（読んでいます…）"}</p>
          ) : !result ? (
            <p className="mt-4 text-sm text-stone-500">読んでいます…</p>
          ) : (
            <div className="mt-6 space-y-6">
              {result.mock && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">API キーが無いので、仮の出力です。引用は本文の発話ですが、判定と点は仮です。</p>}
              <section className="rounded border border-stone-200 bg-white p-4">
                <h2 className="font-bold">判定</h2>
                <div className="mt-2 flex flex-wrap gap-6 text-sm">
                  <p>
                    AI：<span className="text-lg font-semibold">{result.step4.verdict}</span>
                  </p>
                  <p>
                    自分：<span className="text-lg font-semibold">{fu?.selfVerdict}</span>
                  </p>
                </div>
                {fu?.selfVerdict !== result.step4.verdict && <p className="mt-1 text-xs text-stone-600">自分の判定と AI の判定がずれています。ずれは、どちらが正しいかではなく、確かめる点です。</p>}
                <p className="mt-3 text-sm">
                  <span className="font-semibold">なぜ</span>　{result.step4.why}
                </p>
                {result.step4.quotes.length > 0 ? (
                  <blockquote className="mt-3 border-l-4 border-stone-400 pl-3">
                    {result.step4.quotes.map((q) => (
                      <div key={q.index} className="mb-2">
                        <p className="text-sm">「{q.text}」</p>
                        <p className="mt-1 text-xs text-stone-500">
                          {transcript.utterances[q.index]?.speaker}・
                          <button type="button" onClick={() => setOpenQuote(openQuote === q.index ? null : q.index)} className="text-sky-800 hover:underline">
                            発話 {q.index}
                          </button>
                          <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">引用は原文と一致</span>
                        </p>
                        {openQuote === q.index && <UtteranceContext t={transcript} index={q.index} />}
                      </div>
                    ))}
                  </blockquote>
                ) : (
                  <p className="mt-3 text-sm text-stone-600">根拠の引用はありません（場面が無かったときは、引用が無いのが正しい形です）。</p>
                )}
                {result.step4.otherPersonLine && <p className="mt-3 text-sm text-stone-700">相手が前回決めたことについて：{result.step4.otherPersonLine}</p>}
              </section>

              <section>
                <h2 className="font-bold">項目ごとの点と合計</h2>
                <ScoreTable items={result.step4.items} total={result.step4.total} t={transcript} selfScore={fu?.selfScore ?? null} />
              </section>

              {third && (
                <section className="rounded border-2 border-sky-700 bg-sky-50 p-4">
                  <p className="text-sm font-semibold">この行動を追うのは 3 回目です。続けますか、変えますか。</p>
                  <p className="mt-1 text-xs text-stone-600">同じ行動は 2〜3 回で身につくことが多く、それ以上は別の場面に向けたほうが伸びやすいためです。</p>
                  <div className="mt-2 flex gap-2 text-sm">
                    <button type="button" onClick={keep} className="rounded border border-stone-300 bg-white px-3 py-1">
                      続ける
                    </button>
                    <button type="button" onClick={change} className="rounded bg-sky-800 px-3 py-1 text-white">
                      変える（今回の面談から選び直す）
                    </button>
                  </div>
                </section>
              )}

              <div className="rounded border border-dashed border-stone-300 p-3 text-sm text-stone-600">
                次の面談も同じ行動を追うなら、このまま次の文字起こしを貼ります。新しい面談として振り返るなら、画面 1 から始めます。
                <Link href="/" className="ml-2 text-sky-800 underline">
                  画面 1 へ
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
