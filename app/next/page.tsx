"use client";

// 画面 4：前回のひとつを確かめる。次の面談を「1 入力」で貼って整形したあと、読む（画面 2）の前に通る。
// 貼る欄と整形は画面 1 にあり、ここには置かない（面談は 1 回ごとに 1 から入る。app/lib/next-meeting.mts）。
// 先に本人が「できた／一部／まだ／場面がなかった」を付け、そのあと AI の判定と AI の見立て（なぜ）を出す。本人の判定は API に渡さない（決まり 10）。
// 本人と AI の判定を並べ、ずれは確かめる点として出す。点はここに出さない（この面談の点は、画面 2 で自分の点を付けてから読む）。
// AI の見立ては画面 2・3 と同じ部品：解釈の札、要の一句を蛍光ペン風に、すぐ下に「会話を確認する」（根拠の引用はその中。11/8 に本人が決めた）。
// 前回（行動を決めた面談）の発言は、前回のひとつの箱の下に、押すと開く形で置く。保存してある照合済みの引用で、
// 出す前に前回の発話の本文ともう一度照らす（app/lib/previous-quote.mts）。AI を呼び直さない。
// 続けるか変えるかは、この面談の画面 3 で決める。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { FollowUpResponse } from "@/engine/server.mts";
import type { FollowUpVerdict } from "@/engine/types.mts";
import { previousQuoteOf } from "@/app/lib/previous-quote.mts";
import { RefChip } from "@/app/components/RefText";
import { ConversationLink, Fold, KindBadge, ReadingText, RefSpots } from "@/app/components/SceneParts";
import type { QuoteSet } from "@/app/components/SceneParts";
import { BTN_PRIMARY, BTN_SMALL, H1, H2, INSET, LABEL, LEAD, LINK, NOTE, PAGE, QUIET_LINK, SEG, SPARK_BOX, segItem } from "@/app/components/ui";
import { sceneSpan } from "@/app/lib/scene-view.mts";
import { CRITERION_LABEL, refLabel } from "@/app/lib/words.mts";
import { findUtteranceIndices } from "@/engine/utterance-no.mts";
import { WaitPanel } from "@/app/components/WaitPanel";
import { RecordsLink } from "@/app/components/RecordViews";
import { loadSession, newFollowUp, updateSession, useSession } from "@/app/lib/session";
import { sameTranscript } from "@/app/lib/input-guard.mts";

const VERDICTS: FollowUpVerdict[] = ["できた", "一部", "まだ", "場面がなかった"];

export default function Screen5() {
  const session = useSession();
  /** 確かめ（AI の判定）の失敗。やり直しのボタンを判定の所に出す */
  const [followError, setFollowError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [verdict, setVerdict] = useState<FollowUpVerdict | null>(null);
  const sessionId = session?.id;
  const started = useRef(false);
  const run = useRef(0);

  const prev = session?.prev ?? null;
  /** 前の面談で決めて、持ち越したひとつ */
  const spark = prev?.spark ?? null;
  const fu = session?.followUp ?? null;
  /** 今回の面談（画面 1 で整形したもの） */
  const transcript = session?.transcript ?? null;
  const result = fu?.result ?? null;

  useEffect(() => {
    // AI の読みは、本人の判定と並行して始める。本人の判定はこの呼び出しに入れない（決まり 10）
    if (!spark || !transcript || result || started.current) return;
    started.current = true;
    const thisRun = ++run.current;
    const payload = { transcript, spark: { sentence: spark.sentence, criterion: spark.criterion, previousScene: spark.previousScene } };
    (async () => {
      try {
        const r = await fetch("/api/followup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const d = (await r.json()) as FollowUpResponse & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `確かめに失敗しました（${r.status}）`);
        // 待つ間に面談や行動が変わっていたら、この判定を保存しない
        const now = loadSession();
        if (!now || now.id !== sessionId || now.prev?.spark?.id !== spark.id || !sameTranscript(now.transcript, transcript)) {
          if (run.current === thisRun) {
            started.current = false;
            setRetry((n) => n + 1);
          }
          return;
        }
        updateSession((s) => {
          const f = s.followUp ?? newFollowUp();
          const counted = f.countedSparkId === spark.id;
          return {
            ...s,
            followUp: { ...f, result: { step4: d.step4, mock: d.mock }, countedSparkId: spark.id },
            // 追った回数は、持ち越したひとつに数える（同じ結果で二重に数えない）
            prev: s.prev?.spark && !counted ? { ...s.prev, spark: { ...s.prev.spark, timesFollowed: s.prev.spark.timesFollowed + 1 } } : s.prev,
          };
        });
        // 保存したら印を下ろす。Next は前の画面を消さずに隠して残す（cacheComponents）ので、印が残ると、
        // 1 に戻って発言を直す・整形し直すで判定が消えたあと、この画面に戻っても読み直さない
        if (run.current === thisRun) started.current = false;
      } catch (e) {
        setFollowError((e as Error).message);
        started.current = false;
      }
    })();
  }, [spark, transcript, result, sessionId, retry]);

  if (session === undefined) return <main className={`${PAGE} text-sm text-ink-2`}>読み込んでいます…</main>;
  if (!session || !spark) {
    return (
      <main className={PAGE}>
        <section>
          <h1 className={H1}>前回のひとつを確かめる</h1>
          <p className={LEAD}>確かめるひとつがありません。前の面談で行動をひとつ決め、「次の面談の入力へ」を押すと、次の面談でここを通ります。</p>
          <Link href={session?.transcript ? "/reflection" : "/"} className={`mt-3 inline-block ${LINK}`}>
            {session?.transcript ? "2 読む へ" : "1 入力 へ"}
          </Link>
        </section>
      </main>
    );
  }
  if (!transcript) {
    return (
      <main className={PAGE}>
        <section>
          <h1 className={H1}>前回のひとつを確かめる</h1>
          <p className={LEAD}>先に「1 入力」で、次の面談の文字起こしを貼って、話者を分けてください。</p>
          <Link href="/" className={`mt-3 inline-block ${LINK}`}>
            1 入力 へ
          </Link>
        </section>
      </main>
    );
  }

  const submitSelf = () => {
    if (!verdict) return;
    updateSession((s) => ({ ...s, followUp: { ...(s.followUp ?? newFollowUp()), selfVerdict: verdict } }));
  };
  const selfDone = fu?.selfVerdict !== null && fu?.selfVerdict !== undefined;
  /** 前回（行動を決めた面談）の発言。prev.session.transcript は、前の面談の整形後の発話 */
  const prevTranscript = prev?.session.transcript ?? null;
  const prevQuote = previousQuoteOf(spark.previousScene?.quoteText, prevTranscript?.utterances);

  // AI の見立て（なぜ）の根拠：照合済みの引用と、なぜが指す発話。前の作りの出力は、文の中の番号を読む
  const step4 = result?.step4 ?? null;
  const quoteSet: QuoteSet = { type: "followup", quotes: step4?.quotes ?? [], discardedQuotes: step4?.discardedQuotes ?? [] };
  const whySpan = step4 ? sceneSpan(step4.quotes, transcript.utterances.length) : null;
  const whyPointed = step4 ? (step4.whyRefs ?? findUtteranceIndices(step4.why)) : [];
  const otherPointed = step4?.otherPersonLine ? (step4.otherRefs ?? findUtteranceIndices(step4.otherPersonLine)) : [];

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
        <h1 className={H1}>前回のひとつを確かめる</h1>
        <p className={LEAD}>前回決めた行動が、今回の面談でどう現れたかを確かめます。先に自分で判定を付け、そのあと AI の判定を読みます。</p>

        <div className={`mt-6 ${SPARK_BOX}`}>
          <p className="text-xs font-semibold text-amber-900">
            前回決めた、次に試すひとつ{spark.timesFollowed > 0 ? `（${spark.timesFollowed} 回追った）` : ""}
          </p>
          <p className="mt-1 text-[1.08rem] font-semibold leading-[1.7]">{spark.sentence}</p>
          {spark.criterion && <p className="mt-1.5 text-[0.92rem] text-ink-2">{CRITERION_LABEL}：{spark.criterion}</p>}
        </div>
        {prevQuote && (
          <Fold id="previous-quote" label="前回この行動を決めた場面の発言を見る" className="mt-2">
            <div className="rounded-md bg-tint-self px-4 py-3">
              <p className="whitespace-pre-wrap">{prevQuote.text}</p>
            </div>
            <p className="mt-1.5 px-1 text-xs text-ink-3">
              前回の面談・{prevQuote.speaker}
              {prevQuote.index !== null &&
                (prevTranscript ? (
                  <RefChip t={prevTranscript} index={prevQuote.index} className="ml-2">
                    {refLabel(prevQuote.index)}
                  </RefChip>
                ) : (
                  <span className="ml-2">{refLabel(prevQuote.index)}</span>
                ))}
              {VERIFIED}
            </p>
          </Fold>
        )}
      </section>

      <section className="mt-12">
        <h2 className={H2}>自分の判定</h2>
        {selfDone ? (
          <p className="mt-3">
            自分の判定：<span className="font-semibold">{fu?.selfVerdict}</span>
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
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={submitSelf} disabled={!verdict} className={BTN_PRIMARY}>
                この判定に決めて、AI の判定を見る
              </button>
              <span className="text-[0.86rem] text-ink-3">
                {result ? "AI の判定は届いています。" : followError ? "AI の読みに失敗しました。判定を付けると、やり直せます。" : "AI が読んでいます（1 分ほど）。"}
              </span>
            </div>
            <Link href="/reflection" className={`mt-4 inline-block text-[0.86rem] ${QUIET_LINK}`}>
              あとで確かめる（2 読む へ進む）
            </Link>
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
        <section className="mt-12">
          <WaitPanel
            title="AI が面談を読んでいます"
            estimate="1 分ほど"
            view={{ current: 0, status: "前回決めた行動が、今回の面談でどう現れたかを読んでいます", ratio: null }}
          />
        </section>
      ) : (
        <>
          <section className="mt-12">
            {result.mock && <p className={`mb-5 ${NOTE}`}>API キーが無いので、仮の出力です。引用は本文の発言ですが、判定は仮です。</p>}
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
            <section aria-label="AI の見立て" className={`mt-6 ${INSET}`}>
              <h3 className="flex items-center gap-2 text-xs font-semibold text-ink-3">
                AI の見立て
                <KindBadge>解釈</KindBadge>
              </h3>
              <p className="mt-1.5 whitespace-pre-line text-pretty text-[1rem] leading-[1.85]">
                <ReadingText t={transcript} text={result.step4.why} keyPhrase={result.step4.whyKey ?? null} />
              </p>
              <div className="mt-2">
                {whySpan || whyPointed.length > 0 ? (
                  <ConversationLink t={transcript} scene={quoteSet} span={whySpan} pointed={whyPointed} />
                ) : (
                  <p className="text-[0.9rem] text-ink-2">根拠の引用はありません（場面が無かったときは、引用が無いのが正しい形です）。</p>
                )}
              </div>
            </section>
            {result.step4.otherPersonLine && (
              <section aria-label="相手が前回決めたこと" className="mt-6 px-1">
                <h3 className="text-xs font-semibold text-ink-3">相手が前回決めたこと</h3>
                <p className="mt-1.5 text-[0.95rem] leading-[1.8] text-pretty">
                  <ReadingText t={transcript} text={result.step4.otherPersonLine} keyPhrase={null} />
                </p>
                <RefSpots t={transcript} scene={quoteSet} span={whySpan} indices={otherPointed} idPrefix="other-line" />
              </section>
            )}
          </section>

          <div className="mt-10">
            <Link href="/reflection" className={BTN_PRIMARY}>
              次へ　フィードバックを読む
            </Link>
          </div>
          <p className="mt-3 text-[0.86rem] leading-[1.7] text-ink-3">この面談の読みと点数は、次の「2 読む」で受け取ります。前回のひとつを続けるか変えるかは、「3 次に試すひとつ」で決めます。</p>
          <RecordsLink className="mt-4 inline-block px-1 text-[0.92rem]" />
        </>
      )}
    </main>
  );
}
