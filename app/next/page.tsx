"use client";

// 画面 5：次の面談で。続きの面談を貼る → 整形して確かめる → 先に「できた／一部／まだ／場面がなかった」と自分の点を付ける →
// そのあと AI の判定・根拠の引用・なぜの一文・項目ごとの点。本人の自己評価は API に渡さない（決まり 10）。
// 本人と AI の判定を並べ、ずれは確かめる点として出す。同じ行動を追うのが 3 回目なら、続けるか変えるかを聞く。
// 判定の所に、前回（行動を決めた面談）の発言を今回の根拠の発言と並べる。前回の発言は保存してある照合済みの引用で、
// 出す前に前回の発話の本文ともう一度照らす（app/lib/previous-quote.mts）。AI を呼び直さない。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { FollowUpResponse, Step0Response } from "@/engine/server.mts";
import { splitUtterance } from "@/engine/transcript-edit.mts";
import type { FollowUpVerdict, Utterance } from "@/engine/types.mts";
import { CheckGroups } from "@/app/components/CheckGroups";
import { CheckUtterance } from "@/app/components/CheckUtterance";
import { countChecks, countToCheck, groupChecks } from "@/app/lib/check-groups.mts";
import { previousQuoteOf } from "@/app/lib/previous-quote.mts";
import { Collapsible } from "@/app/components/Collapsible";
import { RefChip, RefText } from "@/app/components/RefText";
import { ScoreTable } from "@/app/components/Scores";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, BTN_SMALL_PRIMARY, FIELD, H1, H2, LABEL, LEAD, LINK, NOTE, PAGE, SEG, SPARK_BOX, segItem } from "@/app/components/ui";
import { refLabel } from "@/app/lib/words.mts";
import { UtteranceContext } from "@/app/components/UtteranceView";
import { WaitNote } from "@/app/components/WaitNote";
import { fetchStep0c, newFollowUp, newSession, updateSession, useSession } from "@/app/lib/session";

const VERDICTS: FollowUpVerdict[] = ["できた", "一部", "まだ", "場面がなかった"];

export default function Screen5() {
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 追跡（AI の判定）の失敗。整形の失敗（error）と分けて、やり直しのボタンを判定の所に出す */
  const [followError, setFollowError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
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
        setFollowError((e as Error).message);
        started.current = false;
      }
    })();
  }, [spark, transcript, result, retry]);

  if (session === undefined) return <main className={`${PAGE} text-sm text-ink-2`}>読み込んでいます…</main>;
  if (!session || (!spark && !session.sparkSkipped)) {
    return (
      <main className={PAGE}>
        <section>
          <p>先に「4 次に試すひとつ」で、試す行動を決めてください。</p>
          <Link href="/spark" className={`mt-2 inline-block ${LINK}`}>
            4 次に試すひとつ へ
          </Link>
        </section>
      </main>
    );
  }
  if (!spark) {
    return (
      <main className={PAGE}>
        <section>
          <h1 className={H1}>次の面談で</h1>
          <p className={LEAD}>前回は行動を見送ったので、追うものがありません。次の面談は「1 入力」から新しく始めてください。</p>
          <Link href="/" className={`mt-3 inline-block ${LINK}`}>
            1 入力 へ
          </Link>
        </section>
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
    setFollowError(null);
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
  /** AI が読んだ後に本文を直したら、その判定を消して読み直す（自分の評価は残す。追った回数は二重に数えない） */
  const update = (next: Utterance) => {
    started.current = false;
    updateSession((s) =>
      s.followUp?.transcript
        ? { ...s, followUp: { ...s.followUp, result: null, transcript: { ...s.followUp.transcript, utterances: s.followUp.transcript.utterances.map((u) => (u.index === next.index ? next : u)) } } }
        : s,
    );
  };
  const split = (u: Utterance, pos: number) => {
    started.current = false;
    updateSession((s) => (s.followUp?.transcript ? { ...s, followUp: { ...s.followUp, result: null, transcript: splitUtterance(s.followUp.transcript, u.index, pos) } } : s));
  };
  const submitSelf = () => {
    const n = Number(score);
    if (!verdict || !Number.isInteger(n) || n < 1 || n > 10) return;
    updateSession((s) => ({ ...s, followUp: { ...(s.followUp ?? newFollowUp()), selfVerdict: verdict, selfScore: n } }));
  };
  const selfDone = fu?.selfVerdict !== null && fu?.selfVerdict !== undefined;
  const groups = transcript ? groupChecks(transcript) : null;
  const checkCount = groups ? countChecks(groups) : 0;
  const toCheckCount = groups ? countToCheck(groups) : 0;
  const correctedCount = groups?.corrected.length ?? 0;
  const third = spark.timesFollowed >= 3 && !spark.keepAfterThird;
  /** 前回（行動を決めた面談）の発言。session.transcript は、その面談の整形後の発話 */
  const prevQuote = previousQuoteOf(spark.previousScene?.quoteText, session.transcript?.utterances);
  const keep = () => updateSession((s) => ({ ...s, spark: s.spark ? { ...s.spark, keepAfterThird: true } : s.spark }));
  const change = () => {
    // 今回の面談を新しい面談として画面 2 から始め、別の行動を選び直す
    if (!transcript) return;
    updateSession((s) => ({ ...newSession(s.kind, s.otherName, raw), firstMeeting: false, transcript, mock: fu?.mock ?? false, step0Ms: fu?.step0Ms ?? null }));
    router.push("/reflection");
  };

  const VERIFIED = (
    <span className="ml-3 whitespace-nowrap text-ink-2">
      <span aria-hidden="true" className="mr-1 font-bold text-accent">
        ✓
      </span>
      引用は原文と一致
    </span>
  );

  return (
    <main className={PAGE}>
      <section>
        <h1 className={H1}>次の面談で</h1>
        <p className={LEAD}>次の面談が終わったら、その文字起こしをここに貼ります。前回決めた行動が、その面談でどう現れたかを確かめます。先に自分で評価を付け、そのあと AI の判定を読みます。</p>

        <div className={`mt-6 ${SPARK_BOX}`}>
          <p className="text-xs font-semibold text-amber-900">
            前回決めた、次に試すひとつ{spark.timesFollowed > 0 ? `（${spark.timesFollowed} 回追った）` : ""}
          </p>
          <p className="mt-1 text-[1.08rem] font-semibold leading-[1.7]">{spark.sentence}</p>
          {spark.criterion && <p className="mt-1.5 text-[0.92rem] text-ink-2">できたかの基準：{spark.criterion}</p>}
        </div>

        <label className="mt-7 block">
          <span className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>次の面談の文字起こし</span>
            <span className="text-xs tabular-nums text-ink-3">{[...raw].length} 字</span>
          </span>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={transcript ? 4 : 7} placeholder="ここに貼る。実在の人の名前が入っていないかを確かめてください。" className={`mt-1.5 block w-full ${FIELD}`} />
        </label>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={format} disabled={busy || raw.trim() === ""} className={transcript ? BTN_SECONDARY : BTN_PRIMARY}>
            {busy ? "整形しています…" : transcript ? "もう一度整形する" : "整形する"}
          </button>
          <button type="button" onClick={loadDemo} disabled={busy} className={BTN_SECONDARY}>
            サンプルの続きを選ぶ（Demo Mode）
          </button>
        </div>
        {busy && <WaitNote time="1 分ほど" reopen="開き直して、もう一度「整形する」を押してください。貼った文字起こしは残っています。" />}
        {error && <p className="mt-3 text-[0.92rem] text-red-700">{error}　もう一度「整形する」を押すと、やり直せます。</p>}
      </section>

      {transcript && (
        <>
          <section className="mt-16">
            {fu?.mock && <p className={`mb-5 ${NOTE}`}>API キーが無いので、整形は仮の出力です。</p>}
            <h2 className={H2}>{transcript.utterances.length} の発言に区切り、話者を付けました</h2>
            <p className={LEAD}>このまま進めます。気になるときだけ、開いて確かめてください。</p>
            <Collapsible label={`確かめて直す（${toCheckCount + correctedCount} 件）`} openLabel="確かめる所を閉じる" className="mt-4">
              {groups && <CheckGroups t={transcript} groups={groups} onChange={update} onSplit={split} className="mt-6" />}
              {checkCount === 0 && <p className="text-[0.92rem] text-ink-2">0 件です。0 件は、聞き違いが無いことの証明ではありません。</p>}
            </Collapsible>
            <Collapsible label={`全文を見る（発言 ${transcript.utterances.length} 回）`} openLabel="全文を閉じる" className="mt-2">
              <div className="mt-4 space-y-3">
                {transcript.utterances.map((u) => (
                  <CheckUtterance key={u.index} t={transcript} u={u} onChange={update} onSplit={split} />
                ))}
              </div>
            </Collapsible>
          </section>

          <section className="mt-16">
            <h2 className={H2}>自分の評価</h2>
            {selfDone ? (
              <p className="mt-3">
                自分の判定：<span className="font-semibold">{fu?.selfVerdict}</span>
                <span className="ml-6">
                  自分の点：<span className="font-semibold tabular-nums">{fu?.selfScore}／10</span>
                </span>
              </p>
            ) : (
              <>
                <p className={LEAD}>AI の判定を読む前に付けます。AI には渡しません。</p>
                <p className={`mt-6 ${LABEL}`} id="verdict-label">
                  前回決めた行動は、今回の面談で
                </p>
                <div className={`mt-1.5 ${SEG}`} role="group" aria-labelledby="verdict-label">
                  {VERDICTS.map((v) => (
                    <button key={v} type="button" onClick={() => setVerdict(v)} aria-pressed={verdict === v} className={segItem(verdict === v)}>
                      {v}
                    </button>
                  ))}
                </div>
                <p className={`mt-6 ${LABEL}`} id="score-label">
                  この面談の点（10 点満点）
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="score-label">
                  {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setScore(v)}
                      aria-pressed={score === v}
                      className={`h-11 w-10 rounded-md border text-[0.95rem] tabular-nums ${score === v ? "border-accent bg-accent text-white" : "border-line-2 bg-white text-ink-2 hover:border-ink-2"}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button type="button" onClick={submitSelf} disabled={!verdict || !(Number(score) >= 1 && Number(score) <= 10)} className={BTN_PRIMARY}>
                    この評価に決めて、AI の判定を見る
                  </button>
                  <span className="text-[0.86rem] text-ink-3">
                    {result ? "AI の判定は届いています。" : followError ? "AI の読みに失敗しました。評価を付けると、やり直せます。" : "AI が読んでいます（1 分ほど）。"}
                  </span>
                </div>
              </>
            )}
          </section>

          {!selfDone ? null : followError && !result ? (
            <div className={`mt-6 ${NOTE}`}>
              <p className="text-red-700">AI が読めませんでした：{followError}</p>
              <button
                type="button"
                onClick={() => {
                  setFollowError(null);
                  setRetry((n) => n + 1);
                }}
                className={`mt-2 ${BTN_SMALL}`}
              >
                もう一度読む
              </button>
            </div>
          ) : !result ? (
            <section className="mt-16">
              <p className="font-semibold">AI が面談を読んでいます…</p>
              <WaitNote time="1 分ほど" reopen="この画面を開き直すと、もう一度読みます。自分の評価は残っています。" />
            </section>
          ) : (
            <>
              <section className="mt-16">
                {result.mock && <p className={`mb-5 ${NOTE}`}>API キーが無いので、仮の出力です。引用は本文の発言ですが、判定と点は仮です。</p>}
                <h2 className={H2}>判定</h2>
                <dl className="mt-4 flex flex-wrap gap-x-12 gap-y-3">
                  <div>
                    <dt className="text-xs text-ink-3">AI の判定</dt>
                    <dd className="text-[1.4rem] font-semibold leading-snug">{result.step4.verdict}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">自分の判定</dt>
                    <dd className="text-[1.4rem] font-semibold leading-snug">{fu?.selfVerdict}</dd>
                  </div>
                </dl>
                {fu?.selfVerdict !== result.step4.verdict && <p className="mt-2 text-[0.86rem] text-ink-2">自分の判定と AI の判定がずれています。ずれは、どちらが正しいかではなく、確かめる点です。</p>}
                <p className="mt-6 text-xs font-semibold text-ink-3">なぜ</p>
                <p className="mt-1">
                  <RefText t={transcript} text={result.step4.why} />
                </p>

                {prevQuote && (
                  <div className="mt-7">
                    <p className="text-xs font-semibold text-ink-3">前回（この行動を決めた面談）の発言</p>
                    <div className="mt-1.5 rounded-md bg-tint-self px-4 py-3">
                      <p className="whitespace-pre-wrap">{prevQuote.text}</p>
                    </div>
                    <p className="mt-1.5 px-1 text-xs text-ink-3">
                      {prevQuote.speaker}
                      {prevQuote.index !== null &&
                        (session.transcript ? (
                          <RefChip t={session.transcript} index={prevQuote.index} className="ml-2">
                            {refLabel(prevQuote.index)}
                          </RefChip>
                        ) : (
                          <span className="ml-2">{refLabel(prevQuote.index)}</span>
                        ))}
                      {VERIFIED}
                    </p>
                  </div>
                )}
                {result.step4.quotes.length > 0 ? (
                  <div className="mt-7">
                    <p className="text-xs font-semibold text-ink-3">今回の発言（判定の根拠）</p>
                    {result.step4.quotes.map((q) => (
                      <div key={q.index} className="mt-1.5 [&+div]:mt-4">
                        <div className="rounded-md bg-accent-mid px-4 py-3 shadow-[inset_4px_0_0_var(--color-accent)]">
                          <p className="whitespace-pre-wrap font-medium">{q.text}</p>
                        </div>
                        <p className="mt-1.5 px-1 text-xs text-ink-3">
                          {transcript.utterances[q.index]?.speaker}
                          <RefChip t={transcript} index={q.index} onClick={() => setOpenQuote(openQuote === q.index ? null : q.index)} className="ml-2">
                            {refLabel(q.index)}
                          </RefChip>
                          <span className="ml-1">（押すと前後も開きます）</span>
                          {VERIFIED}
                        </p>
                        {openQuote === q.index && <UtteranceContext t={transcript} index={q.index} />}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-6 text-[0.95rem] text-ink-2">根拠の引用はありません（場面が無かったときは、引用が無いのが正しい形です）。</p>
                )}
                {result.step4.otherPersonLine && (
                  <p className="mt-6 text-[0.95rem] text-ink-2">
                    相手が前回決めたことについて：
                    <RefText t={transcript} text={result.step4.otherPersonLine} />
                  </p>
                )}
              </section>

              <section className="mt-16">
                <h2 className={H2}>項目ごとの点と合計</h2>
                <ScoreTable items={result.step4.items} total={result.step4.total} t={transcript} selfScore={fu?.selfScore ?? null} />
              </section>

              {third && (
                <section className="mt-6 rounded-lg bg-accent-soft px-5 py-5 sm:px-8">
                  <p className="font-semibold">この行動を追うのは 3 回目です。続けますか、変えますか。</p>
                  <p className="mt-1 text-[0.86rem] text-ink-2">同じ行動は 2〜3 回で身につくことが多く、それ以上は別の場面に向けたほうが伸びやすいためです。</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={keep} className={BTN_SMALL}>
                      続ける
                    </button>
                    <button type="button" onClick={change} className={BTN_SMALL_PRIMARY}>
                      変える（今回の面談から選び直す）
                    </button>
                  </div>
                </section>
              )}

              <p className="mt-8 px-1 text-[0.92rem] text-ink-2">
                次の面談も同じ行動を追うなら、この画面に次の文字起こしを貼ります。新しい面談として振り返るなら、
                <Link href="/" className={LINK}>
                  1 入力
                </Link>
                から始めます。
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
