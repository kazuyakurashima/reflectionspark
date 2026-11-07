"use client";

// 画面 4：次に試すひとつ（Your Spark）。候補 2〜3 から選ぶ・直す・見送る。
// 候補は「もし（場面）なら、（行動）する」の一文が見え、押すとセリフの例とできたかの基準が開く。
// 選ぶ・直す・見送るのは本人（決まり 7）。選んだ一つだけを目立つ下地に置く。持ち帰るものは一つ。
// 前の面談から持ち越したひとつがあれば、候補の下に「前回のひとつを続ける」を置く（続けるか変えるかも本人が決める）。
// 終わりの「今日はここまでにする」で、決めたひとつを持ち越して「1 入力」に戻る（app/lib/next-meeting.mts）。面談はまだ始めない。
// 画面 1 は次の面談を待つ形になり、次の面談が終わったらそこに貼る。ボタンは一つだけにする（同じ働きのボタンを並べない）。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { CandidatesResponse } from "@/engine/server.mts";
import type { Candidate } from "@/engine/types.mts";
import { Collapsible } from "@/app/components/Collapsible";
import { RefChip, RefText } from "@/app/components/RefText";
import { WaitPanel } from "@/app/components/WaitPanel";
import { PreviousWordsBlock, RepeatScenesBlock } from "@/app/components/RecordViews";
import { candidatesBody } from "@/app/lib/demo-flag.mts";
import { BTN_PRIMARY, BTN_SMALL, BTN_SMALL_PRIMARY, FIELD, H1, H2, INSET, LABEL, LEAD, LINK, NOTE, PAGE, QUIET_LINK, SPARK_BOX } from "@/app/components/ui";
import { refLabel, sceneTypeLabel } from "@/app/lib/words.mts";
import { keptSpark, startNextMeeting } from "@/app/lib/next-meeting.mts";
import { answerText, loadSession, makeSparkId, newSession, updateSession, useSession } from "@/app/lib/session";
import { sameTranscript } from "@/app/lib/input-guard.mts";
import type { SparkChoice } from "@/app/lib/session";

export default function Screen4() {
  const router = useRouter();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftSentence, setDraftSentence] = useState("");
  const [draftCriterion, setDraftCriterion] = useState("");
  const started = useRef(false);
  const run = useRef(0);
  const [retry, setRetry] = useState(0);

  const analysis = session?.analysis ?? null;
  const transcript = session?.transcript ?? null;
  const candidates = session?.candidates ?? null;
  const nextScene = analysis?.step1.scenes.find((s) => s.type === "次に試せる所") ?? null;

  useEffect(() => {
    if (!session || !transcript || !nextScene || candidates || started.current) return;
    started.current = true;
    const thisRun = ++run.current;
    const answer = answerText(session);
    (async () => {
      try {
        const r = await fetch("/api/candidates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // サンプルの印があるときだけ demo: true を送る（貼った面談に、サンプルの講師の記録を添えない）
          body: JSON.stringify(candidatesBody({ transcript, scene: nextScene, answer, demo: session.demo })),
        });
        const d = (await r.json()) as CandidatesResponse & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `候補を作れませんでした（${r.status}）`);
        // 待つ間に面談・印・答えが変わっていたら、この候補を保存しない（貼った面談に、サンプルの講師の言葉を出さないため）
        const now = loadSession();
        if (!now || now.id !== session.id || now.demo !== session.demo || !sameTranscript(now.transcript, transcript) || answerText(now) !== answer) {
          if (run.current === thisRun) {
            started.current = false;
            setRetry((n) => n + 1);
          }
          return;
        }
        updateSession((s) => ({ ...s, candidates: { step3: d.step3, mock: d.mock } }));
        // 保存したら印を下ろす。Next は前の画面を消さずに隠して残す（cacheComponents）ので、印が残ると、
        // 3 に戻って答えを直したあと（候補が消える）、この画面に戻っても候補を作らない
        if (run.current === thisRun) started.current = false;
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
        <section>
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
    updateSession((s) => ({ ...s, spark, sparkSkipped: false }));
    setEditing(null);
  };
  const skip = () => updateSession((s) => ({ ...s, spark: null, sparkSkipped: true }));
  /** 前の面談から持ち越したひとつと、この面談での確かめ */
  const prevSpark = session.prev?.spark ?? null;
  const check = session.followUp;
  /** 前回のひとつを、次の面談でも続ける */
  const keepPrev = () => {
    if (!prevSpark) return;
    updateSession((s) => ({ ...s, spark: keptSpark(prevSpark, new Date().toISOString()), sparkSkipped: false }));
    setEditing(null);
  };
  /** 今日はここまでにする。決めたひとつ（見送ったなら無し）を持ち越し、入力を空にして「1 入力」へ（次の面談を待つ形） */
  const startNext = () => {
    updateSession((s) => startNextMeeting(s, newSession(s.kind)));
    router.push("/");
  };
  /** 失敗したとき、候補が一つも残らなかったときに、候補を作り直す */
  const recreate = () => {
    setError(null);
    started.current = false;
    updateSession((s) => ({ ...s, candidates: null }));
    setRetry((n) => n + 1);
  };
  const spark = session.spark;
  const keptChosen = spark !== null && prevSpark !== null && spark.id === prevSpark.id;
  const cands = candidates?.step3.candidates ?? [];
  const repeats = candidates?.step3.repeats ?? [];

  const quote = nextScene?.quotes[0] ?? null;

  return (
    <main className={PAGE}>
      <section>
        <h1 className={H1}>
          次に試すひとつ<span className="ml-3 text-[0.86rem] font-normal text-ink-3">Your Spark</span>
        </h1>
        <p className={LEAD}>次の面談で試す行動を、一つだけ持ち帰ります。候補から選ぶ、直して使う、見送る、はあなたが決めます。</p>

        {nextScene && (
          <div className={`mt-6 ${INSET}`}>
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

        {repeats.length > 0 && <RepeatScenesBlock items={repeats} className="mt-6" />}

        {spark && !keptChosen && (spark.edited || !cands.some((c) => c.sentence === spark.sentence)) && (
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
          <p className={`mt-3 ${NOTE}`}>この面談では「課題が見えた場面」が挙がっていないので、候補はありません。候補は、その場面とあなたの答えから作るためです。今回は見送って、先へ進めます。</p>
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
          <WaitPanel className="mt-3" title="候補を作っています" estimate="20〜30 秒ほど" view={{ current: 0, status: "選んだ場面とあなたの答えから、行動の候補を書いています", ratio: null }} />
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
            const chosen = spark !== null && !keptChosen && !spark.edited && spark.sentence === c.sentence;
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
                {c.previous && <PreviousWordsBlock p={c.previous} className="mt-4" />}
                <Collapsible label="セリフの例と、できたかの基準を開く" className={c.previous ? "mt-3" : "mt-2"}>
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
        {prevSpark && (
          <div className={`mt-4 rounded-md border px-5 py-4 ${keptChosen ? "border-amber-300 bg-amber-50" : "border-line-2"}`}>
            <p className={`text-xs font-semibold ${keptChosen ? "text-amber-900" : "text-ink-3"}`}>{keptChosen ? "持ち帰るひとつ（前回のひとつを続ける）" : "前回のひとつを続ける"}</p>
            <p className="mt-1 text-[1.02rem] font-semibold leading-[1.7]">{prevSpark.sentence}</p>
            {prevSpark.criterion && <p className="mt-1.5 text-[0.86rem] leading-[1.7] text-ink-2">できたかの基準：{prevSpark.criterion}</p>}
            {/* AI の判定は、本人が自分の判定を付けた後にだけ出す */}
            {check?.result && check.selfVerdict && (
              <p className="mt-1.5 text-[0.86rem] leading-[1.7] text-ink-2">
                今回の面談での判定：自分「{check.selfVerdict}」、AI「{check.result.step4.verdict}」
              </p>
            )}
            {prevSpark.timesFollowed >= 3 && (
              <p className="mt-1.5 text-[0.86rem] leading-[1.7] text-ink-2">
                この行動を追ったのは {prevSpark.timesFollowed} 回です。同じ行動は 2〜3 回で身につくことが多く、それ以上は別の場面に向けたほうが伸びやすいためです。続けるか変えるかは、あなたが決めます。
              </p>
            )}
            <div className="mt-4">
              <button type="button" onClick={keepPrev} className={BTN_SMALL}>
                {keptChosen ? "これを続けることにした" : "これを続ける"}
              </button>
            </div>
          </div>
        )}
        {/* 候補が無いとき・作れなかったときも、見送って先へ進める */}
        <button type="button" onClick={skip} className={`mt-4 block text-[0.92rem] ${QUIET_LINK}`}>
          今回は見送る（持ち帰らない）
        </button>

        <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={startNext} disabled={!spark && !session.sparkSkipped} className={BTN_PRIMARY}>
            今日はここまでにする
          </button>
          {!spark && !session.sparkSkipped && <span className="text-[0.86rem] text-ink-3">選ぶか見送るかを決めると進めます。</span>}
        </div>
        <p className="mt-3 text-[0.86rem] leading-[1.7] text-ink-3">
          {spark ? "決めたひとつは、次の面談に持ち越します。" : ""}次の面談が終わったら、その文字起こしを「1 入力」に貼ります。
          {spark && "読む前に、このひとつが次の面談でどう現れたかを確かめます。"}
          {session.demo && "サンプルでは、続きの面談をそのまま選べます。"}
          押したあとも、「前の面談に戻る」でこの面談に戻れます。
        </p>
      </section>
    </main>
  );
}
