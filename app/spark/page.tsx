"use client";

// 画面 4：次に試すひとつ（Your Spark）。候補 2〜3 から選ぶ・直す・見送る。
// 候補は「もし（場面）なら、（行動）する」の一文が見え、押すとセリフの例とできたかの基準が開く。
// 選ぶ・直す・見送るのは本人（決まり 7）。選んだ一つだけを目立つ下地に置く。持ち帰るものは一つ。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { CandidatesResponse } from "@/engine/server.mts";
import type { Candidate } from "@/engine/types.mts";
import { utteranceLabel } from "@/engine/utterance-no.mts";
import { Collapsible } from "@/app/components/Collapsible";
import { WaitNote } from "@/app/components/WaitNote";
import { makeSparkId, questionsOf, updateSession, useSession } from "@/app/lib/session";
import type { SparkChoice } from "@/app/lib/session";

export default function Screen4() {
  const router = useRouter();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftSentence, setDraftSentence] = useState("");
  const [draftCriterion, setDraftCriterion] = useState("");
  const started = useRef(false);
  const [retry, setRetry] = useState(0);

  const analysis = session?.analysis ?? null;
  const transcript = session?.transcript ?? null;
  const candidates = session?.candidates ?? null;
  const nextScene = analysis?.step1.scenes.find((s) => s.type === "次に試せる所") ?? null;

  useEffect(() => {
    if (!session || !transcript || !nextScene || candidates || started.current) return;
    started.current = true;
    const qs = questionsOf(session);
    const answer = qs
      .map((q) => ({ q, a: session.answers.find((x) => x.question === q)?.answer.trim() ?? "" }))
      .filter((x) => x.a !== "")
      .map((x) => `問い：${x.q}\n答え：${x.a}`)
      .join("\n\n");
    (async () => {
      try {
        const r = await fetch("/api/candidates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript, scene: nextScene, answer }),
        });
        const d = (await r.json()) as CandidatesResponse & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `候補を作れませんでした（${r.status}）`);
        updateSession((s) => ({ ...s, candidates: { step3: d.step3, mock: d.mock } }));
      } catch (e) {
        setError((e as Error).message);
        started.current = false;
      }
    })();
  }, [session, transcript, nextScene, candidates, retry]);

  if (session === undefined) return <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-stone-600">読み込んでいます…</main>;
  if (!session || !analysis || !transcript) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <p className="text-sm">先に画面 2 でフィードバックを読み、画面 3 で問いに答えてください。</p>
        <Link href="/reflection" className="text-sm text-sky-800 underline">
          画面 2 へ
        </Link>
      </main>
    );
  }

  const choose = (c: Candidate, i: number, edited: { sentence: string; criterion: string } | null) => {
    const spark: SparkChoice = {
      id: makeSparkId(i),
      sentence: edited?.sentence ?? c.sentence,
      criterion: edited?.criterion ?? c.criterion,
      lines: c.lines,
      previousScene: nextScene ? { context: nextScene.context, quoteText: nextScene.quotes[0]?.text ?? null, reading: nextScene.reading } : null,
      chosenAt: new Date().toISOString(),
      edited: edited !== null,
      timesFollowed: 0,
      keepAfterThird: false,
    };
    updateSession((s) => ({ ...s, spark, sparkSkipped: false, followUp: null }));
    setEditing(null);
  };
  const skip = () => updateSession((s) => ({ ...s, spark: null, sparkSkipped: true, followUp: null }));
  /** 失敗したとき、候補が一つも残らなかったときに、候補を作り直す */
  const recreate = () => {
    setError(null);
    started.current = false;
    updateSession((s) => ({ ...s, candidates: null }));
    setRetry((n) => n + 1);
  };
  const spark = session.spark;
  const cands = candidates?.step3.candidates ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold">
        4. 次に試すひとつ <span className="ml-1 text-xs font-normal text-stone-500">Your Spark</span>
      </h1>
      <p className="mt-1 text-sm text-stone-600">次の一回で試す行動を一つだけ持ち帰ります。候補から選ぶ、直して使う、見送る、はあなたが決めます。</p>

      {nextScene && (
        <section className="mt-4 rounded border border-stone-200 bg-white p-4 text-sm">
          <p className="text-xs text-stone-500">次に試せる所</p>
          <p>{nextScene.context}</p>
          {nextScene.quotes[0] && <p className="mt-1 text-stone-700">「{nextScene.quotes[0].text}」（{utteranceLabel(nextScene.quotes[0].index)}）</p>}
        </section>
      )}

      {spark && (
        <section className="mt-4 rounded border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-xs text-amber-900">持ち帰るひとつ{spark.edited ? "（直して使う）" : ""}</p>
          <p className="mt-1 font-semibold">{spark.sentence}</p>
          {spark.criterion && <p className="mt-1 text-sm text-stone-700">できたかの基準：{spark.criterion}</p>}
        </section>
      )}
      {session.sparkSkipped && !spark && <p className="mt-4 rounded border border-stone-300 bg-white px-3 py-2 text-sm">今回は見送りました。次の面談では追跡しません。</p>}

      <section className="mt-5">
        <h2 className="font-bold">候補</h2>
        {candidates?.mock && <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">API キーが無いので、仮の出力です。候補の文は仮です。</p>}
        {!nextScene && (
          <p className="mt-2 rounded border border-stone-300 bg-white px-3 py-2 text-sm">
            この面談では「次に試せる所」の場面が挙がっていないので、候補はありません。候補は、その場面とあなたの答えから作るためです。今回は見送って、次の面談へ進めます。
          </p>
        )}
        {error && (
          <div className="mt-2 rounded border border-red-200 bg-white px-3 py-2 text-sm">
            <p className="text-red-700">候補を作れませんでした：{error}</p>
            <button type="button" onClick={recreate} className="mt-2 rounded border border-stone-300 px-3 py-1">
              もう一度作る
            </button>
          </div>
        )}
        {nextScene && !candidates && !error && (
          <div className="mt-2">
            <p className="text-sm text-stone-500">候補を作っています…</p>
            <WaitNote time="20〜30 秒ほど" reopen="この画面を開き直すと、もう一度作ります。" />
          </div>
        )}
        {candidates && cands.length === 0 && !error && (
          <div className="mt-2 rounded border border-stone-300 bg-white px-3 py-2 text-sm">
            <p>次の面談の文字起こしで確かめられる候補が、一つも残りませんでした。</p>
            <button type="button" onClick={recreate} className="mt-2 rounded border border-stone-300 px-3 py-1">
              もう一度作る
            </button>
          </div>
        )}
        <div className="mt-2 space-y-3">
          {cands.map((c, i) => {
            const chosen = spark !== null && !spark.edited && spark.sentence === c.sentence;
            return (
              <div key={i} className={`rounded border p-4 ${chosen ? "border-amber-400 bg-amber-50" : "border-stone-200 bg-white"}`}>
                <p className="text-sm font-semibold">{c.sentence}</p>
                {c.basis && <p className="mt-1 text-xs text-stone-500">どこから作ったか：{c.basis}</p>}
                <Collapsible label="セリフの例と、できたかの基準を開く" className="mt-2">
                  <p className="text-xs text-stone-500">セリフの例</p>
                  <ul className="list-disc pl-5 text-sm">
                    {c.lines.map((l, j) => (
                      <li key={j}>「{l}」</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-stone-500">できたかの基準（次の面談で何が言葉に表れたら「できた」か）</p>
                  <p className="text-sm">{c.criterion}</p>
                </Collapsible>
                {editing === i ? (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs text-stone-600">
                      一文（もし〜なら、〜する）
                      <textarea value={draftSentence} onChange={(e) => setDraftSentence(e.target.value)} rows={2} className="mt-1 w-full rounded border border-stone-300 p-2 text-sm" />
                    </label>
                    <label className="block text-xs text-stone-600">
                      できたかの基準
                      <textarea value={draftCriterion} onChange={(e) => setDraftCriterion(e.target.value)} rows={2} className="mt-1 w-full rounded border border-stone-300 p-2 text-sm" />
                    </label>
                    <div className="flex gap-2 text-sm">
                      <button type="button" onClick={() => choose(c, i, { sentence: draftSentence.trim(), criterion: draftCriterion.trim() })} disabled={draftSentence.trim() === ""} className="rounded bg-amber-600 px-3 py-1 text-white disabled:opacity-40">
                        この文で持ち帰る
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="rounded border border-stone-300 px-3 py-1">
                        やめる
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2 text-sm">
                    <button type="button" onClick={() => choose(c, i, null)} className="rounded bg-amber-600 px-3 py-1 text-white">
                      {chosen ? "これにした" : "これにする"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(i);
                        setDraftSentence(c.sentence);
                        setDraftCriterion(c.criterion);
                      }}
                      className="rounded border border-stone-300 px-3 py-1"
                    >
                      直して使う
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* 候補が無いとき・作れなかったときも、見送って先へ進める */}
        <button type="button" onClick={skip} className="mt-3 block text-sm text-stone-600 underline underline-offset-2">
          今回は見送る（持ち帰らない）
        </button>
      </section>

      <div className="mt-6 flex items-center gap-3">
        <button type="button" onClick={() => router.push("/next")} disabled={!spark && !session.sparkSkipped} className="rounded bg-sky-800 px-4 py-2 text-sm text-white disabled:opacity-40">
          次へ：次の面談で →
        </button>
        <span className="text-xs text-stone-500">選ぶか見送るかを決めると進めます。</span>
      </div>
    </main>
  );
}
