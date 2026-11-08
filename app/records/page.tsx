"use client";

// 画面 5：記録。記録（Memory）にある面談を、日付の古い順に並べる。読むだけで、AI は呼ばない（GET /api/records）。
// 出すのは事実だけ：照合済みの引用、選んだひとつ、次の回に現れた発言。点は引用の後ろに数字で置く。
// 記録に無い欄は出さない（手で埋めない）。点の移り変わりの図・平均と、その回の AI の読みは出さない。

import Link from "next/link";
import { useState } from "react";

import { RecordEntryView } from "@/app/components/RecordViews";
import { BTN_SMALL, H1, LEAD, LINK, NOTE, PAGE } from "@/app/components/ui";
import { useRecords } from "@/app/lib/records";

export default function Screen6() {
  const [retry, setRetry] = useState(0);
  const records = useRecords(retry);

  return (
    <main className={PAGE}>
      <section>
        <h1 className={H1}>記録</h1>
        {records === undefined ? (
          <p className="mt-4 text-[0.95rem] text-ink-2">記録を読んでいます…</p>
        ) : records === "error" || !records.enabled || !records.ok ? (
          <div className={`mt-6 ${NOTE}`}>
            <p>{records !== "error" && !records.enabled ? "この場所では、記録の読み出しを開いていません。" : "いま記録を読めません。"}</p>
            {(records === "error" || records.enabled) && (
              <button type="button" onClick={() => setRetry((n) => n + 1)} className={`mt-2 ${BTN_SMALL}`}>
                もう一度読む
              </button>
            )}
          </div>
        ) : (
          <>
            <p className={LEAD}>サンプルの講師の記録です（作ったダミーの面談）。前もって分析・記録・夢を回して作りました。この画面は AI を呼びません。</p>
            <p className="mt-1 text-[0.86rem] leading-[1.8] text-ink-3">面談を日付の古い順に並べています。AI の点数は、同じ面談でも揺れることがあります。</p>
            <ol className="mt-12 space-y-16">
              {records.records.map((r) => (
                <li key={r.interviewId}>
                  <RecordEntryView r={r} />
                </li>
              ))}
            </ol>
            <p className="mt-16 text-[0.86rem] leading-[1.8] text-ink-3">Demo Mode で通す面談は、このブラウザの中にあります。Memory には書きません。</p>
          </>
        )}
        <Link href="/" className={`mt-6 inline-block text-[0.92rem] ${LINK}`}>
          1 入力 へ
        </Link>
      </section>
    </main>
  );
}
