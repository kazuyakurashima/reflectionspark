"use client";

// 画面 4：次に試すひとつ（Your Spark）。候補 2〜3 から選ぶ・直す・見送る。
// 候補は「もし（場面）なら、（行動）する」の一文が見え、押すとセリフの例とできたかの基準が開く。
// 選ぶ・直す・見送るのは本人（決まり 7）。選んだ一つだけを目立つ下地に置く。持ち帰るものは一つ。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { CandidatesResponse } from "@/engine/server.mts";
import type { Candidate } from "@/engine/types.mts";
import { Collapsible } from "@/app/components/Collapsible";
import { RefChip, RefText } from "@/app/components/RefText";
import { WaitNote } from "@/app/components/WaitNote";
import { BTN_PRIMARY, BTN_SMALL, BTN_SMALL_PRIMARY, CARD, FIELD, H1, H2, LABEL, LEAD, LINK, NOTE, PAGE, QUIET_LINK, SPARK_BOX } from "@/app/components/ui";
import { refLabel, sceneTypeLabel } from "@/app/lib/words.mts";
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

  if (session === undefined) return <main className={`${PAGE} text-sm text-ink-2`}>読み込んでいます…</main>;
  if (!session || !analysis || !transcript) {
    return (
      <main className={PAGE}>
        <section className={CARD}>
          <p>先に「2 読む」でフィードバックを読み、「3 問いに答える」で問いに答えてください。</p>
          <Link href="/reflection" className={`mt-2 inline-block ${LINK}`}>
            2 読む へ
          </Link>
        </section>
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

  const quote = nextScene?.quotes[0] ?? null;

  return (
    <main className={PAGE}>
      <section className={CARD}>
        <h1 className={H1}>
          次に試すひとつ<span className="ml-3 text-[0.86rem] font-normal text-ink-3">Your Spark</span>
        </h1>
        <p className={LEAD}>次の面談で試す行動を、一つだけ持ち帰ります。候補から選ぶ、直して使う、見送る、はあなたが決めます。</p>

        {nextScene && (
          <div className="mt-6 rounded-md bg-paper px-5 py-4">
            <p className="text-xs font-semibold text-ink-3">{sceneTypeLabel(nextScene.type)}</p>
            <p className="mt-1 text-[0.98rem]">
              <RefText t={transcript} text={nextScene.context} />
            </p>
            {quote && (
              <p className="mt-2 text-[0.98rem] text-ink-2">
                「{quote.text}」
                <RefChip t={transcript} index={quote.index} className="ml-1 text-xs">
                  {refLabel(quote.index)}
                </RefChip>
              </p>
            )}
          </div>
        )}

        {spark && (spark.edited || !cands.some((c) => c.sentence === spark.sentence)) && (
          <div className={`mt-6 ${SPARK_BOX}`}>
            <p className="text-xs font-semibold text-amber-900">持ち帰るひとつ{spark.edited ? "（直して使う）" : ""}</p>
            <p className="mt-1 text-[1.08rem] font-semibold leading-[1.7]">{spark.sentence}</p>
            {spark.criterion && <p className="mt-1.5 text-[0.92rem] text-ink-2">できたかの基準：{spark.criterion}</p>}
          </div>
        )}
        {session.sparkSkipped && !spark && <p className={`mt-6 ${NOTE}`}>今回は見送りました。次の面談では追跡しません。</p>}

        <h2 className={`mt-10 ${H2}`}>候補</h2>
        {candidates?.mock && <p className={`mt-3 ${NOTE}`}>API キーが無いので、仮の出力です。候補の文は仮です。</p>}
        {!nextScene && (
          <p className={`mt-3 ${NOTE}`}>この面談では「次に試せる場面」が挙がっていないので、候補はありません。候補は、その場面とあなたの答えから作るためです。今回は見送って、先へ進めます。</p>
        )}
        {error && (
          <div className={`mt-3 ${NOTE}`}>
            <p className="text-red-700">候補を作れませんでした：{error}</p>
            <button type="button" onClick={recreate} className={`mt-2 ${BTN_SMALL}`}>
              もう一度作る
            </button>
          </div>
        )}
        {nextScene && !candidates && !error && (
          <div className="mt-3">
            <p className="font-semibold">候補を作っています…</p>
            <WaitNote time="20〜30 秒ほど" reopen="この画面を開き直すと、もう一度作ります。" />
          </div>
        )}
        {candidates && cands.length === 0 && !error && (
          <div className={`mt-3 ${NOTE}`}>
            <p>次の面談の文字起こしで確かめられる候補が、一つも残りませんでした。</p>
            <button type="button" onClick={recreate} className={`mt-2 ${BTN_SMALL}`}>
              もう一度作る
            </button>
          </div>
        )}
        <div className="mt-4 space-y-4">
          {cands.map((c, i) => {
            const chosen = spark !== null && !spark.edited && spark.sentence === c.sentence;
            return (
              <div key={i} className={`rounded-md border px-5 py-4 ${chosen ? "border-amber-300 bg-amber-50" : "border-line-2"}`}>
                {chosen && <p className="mb-1 text-xs font-semibold text-amber-900">持ち帰るひとつ</p>}
                <p className="text-[1.02rem] font-semibold leading-[1.7]">{c.sentence}</p>
                {c.basis && (
                  <p className="mt-1.5 text-[0.86rem] leading-[1.7] text-ink-2">
                    どこから作ったか：
                    <RefText t={transcript} text={c.basis} />
                  </p>
                )}
                <Collapsible label="セリフの例と、できたかの基準を開く" className="mt-2">
                  <p className="text-xs font-semibold text-ink-3">セリフの例</p>
                  <ul className="mt-1 space-y-0.5 text-[0.95rem]">
                    {c.lines.map((l, j) => (
                      <li key={j}>「{l}」</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs font-semibold text-ink-3">できたかの基準（次の面談で何が言葉に表れたら「できた」か）</p>
                  <p className="mt-1 text-[0.95rem]">{c.criterion}</p>
                </Collapsible>
                {editing === i ? (
                  <div className="mt-4 space-y-3">
                    <label className="block">
                      <span className={LABEL}>一文（もし〜なら、〜する）</span>
                      <textarea value={draftSentence} onChange={(e) => setDraftSentence(e.target.value)} rows={2} className={`mt-1.5 block w-full ${FIELD}`} />
                    </label>
                    <label className="block">
                      <span className={LABEL}>できたかの基準</span>
                      <textarea value={draftCriterion} onChange={(e) => setDraftCriterion(e.target.value)} rows={2} className={`mt-1.5 block w-full ${FIELD}`} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => choose(c, i, { sentence: draftSentence.trim(), criterion: draftCriterion.trim() })} disabled={draftSentence.trim() === ""} className={BTN_SMALL_PRIMARY}>
                        この文で持ち帰る
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={BTN_SMALL}>
                        やめる
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => choose(c, i, null)} className={BTN_SMALL_PRIMARY}>
                      {chosen ? "これにした" : "これにする"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(i);
                        setDraftSentence(c.sentence);
                        setDraftCriterion(c.criterion);
                      }}
                      className={BTN_SMALL}
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
        <button type="button" onClick={skip} className={`mt-4 block text-[0.92rem] ${QUIET_LINK}`}>
          今回は見送る（持ち帰らない）
        </button>

        <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => router.push("/next")} disabled={!spark && !session.sparkSkipped} className={BTN_PRIMARY}>
            次へ　次の面談で
          </button>
          {!spark && !session.sparkSkipped && <span className="text-[0.86rem] text-ink-3">選ぶか見送るかを決めると進めます。</span>}
        </div>
        <p className="mt-3 text-[0.86rem] leading-[1.7] text-ink-3">今日の振り返りはここまでです。「5 次の面談で」は、次の面談が終わってから、その文字起こしを貼って使います。サンプルでは、続きの面談でそのまま試せます。</p>
      </section>
    </main>
  );
}
