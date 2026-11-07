"use client";

// 記録（Memory）から来た発話の見せ方（画面 4 の前の言葉、記録の画面）。
// 発話そのものは画面 2 と同じ部品（Island）で出し、新しい見せ方は作らない。文は記録の原文のままで、AI が書いた文は出さない（決まり 1）。

import Link from "next/link";
import { useState } from "react";

import type { RecordEntry } from "@/engine/memory-read.mts";
import type { MeetingKind, PreviousWords } from "@/engine/types.mts";
import { formatDate, kindLabel, kindOfSpeakers, linesTranscript, mergeLines, previousLines, recordScoreCells } from "@/app/lib/record-view.mts";
import type { Line } from "@/app/lib/record-view.mts";
import { useRecords } from "@/app/lib/records";
import { sceneTypeLabel } from "@/app/lib/words.mts";
import { Island } from "./UtteranceView";
import { H2, LINK, SPARK_BOX } from "./ui";

const SUB = "text-[0.86rem] font-semibold text-ink-2";
const BOX = "space-y-2.5 rounded-md border border-line bg-surface px-3 py-3.5 text-ink sm:px-4";

/** 前の面談の発話。直前 → 本人 → 直後。本人の発言を目立たせる */
function PreviousLines({ p }: { p: PreviousWords }) {
  const lines = previousLines(p);
  const t = linesTranscript(
    kindOfSpeakers(
      p.own.speaker,
      lines.map((l) => l.speaker),
    ),
    lines,
  );
  return (
    <ol className={BOX}>
      {t.utterances.map((u) => (
        <li key={u.index}>
          <Island t={t} u={u} compact role={u.index === p.own.index ? "focal" : "plain"} tag={p.before?.index === u.index ? "直前" : p.after?.index === u.index ? "直後" : undefined} />
        </li>
      ))}
    </ol>
  );
}

/** 画面 4：候補に添える、前の面談での本人の言葉 */
export function PreviousWordsBlock({ p, className = "" }: { p: PreviousWords; className?: string }) {
  return (
    <div className={className}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="text-[0.86rem] font-semibold text-ink-2">
          前の面談でのあなたの言葉
          <span className="ml-2.5 font-normal tabular-nums text-ink-3">
            {formatDate(p.date)}
            {p.otherTag ? `　${p.otherTag} との面談` : ""}
          </span>
        </span>
        <span className="text-xs text-ink-3">記録（Memory）から</span>
      </p>
      <div className="mt-2">
        <PreviousLines p={p} />
      </div>
    </div>
  );
}

/** 画面 4：今回の「次に試せる所」と同じ形の、前の面談の場面。評価の言葉は付けない */
export function RepeatScenesBlock({ items, className = "" }: { items: PreviousWords[]; className?: string }) {
  return (
    <div className={className}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="text-[0.86rem] font-semibold text-ink-2">前にも、近い場面がありました</span>
        <span className="text-xs text-ink-3">記録（Memory）から</span>
      </p>
      <div className="mt-2 space-y-3">
        {items.map((p) => (
          <div key={`${p.interviewId}｜${p.utterance}`}>
            <p className="mb-1 text-[0.86rem] tabular-nums text-ink-3">
              {formatDate(p.date)}
              {p.otherTag ? `　${p.otherTag} との面談` : ""}
            </p>
            <PreviousLines p={p} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 記録の画面：引用した発言。前後の発話は、押すと開く */
export function RecordLines({ kind, quotes, neighbors }: { kind: MeetingKind; quotes: Line[]; neighbors: Line[] }) {
  const [open, setOpen] = useState(false);
  if (quotes.length === 0) return null;
  const quoted = new Set(quotes.map((q) => q.index));
  const t = linesTranscript(kind, open ? mergeLines(quotes, neighbors) : quotes);
  return (
    <div>
      <ol className={BOX}>
        {t.utterances.map((u) => (
          <li key={u.index}>
            <Island t={t} u={u} compact role={quoted.has(u.index) ? "focal" : "plain"} tag={quoted.has(u.index) ? "引用" : undefined} />
          </li>
        ))}
      </ol>
      {neighbors.length > 0 && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`mt-1.5 text-[0.86rem] ${LINK}`}>
          {open ? "前後の発言を閉じる" : "前後の発言を開く"}
        </button>
      )}
    </div>
  );
}

/** 記録の画面への入口。記録の読み出しが開いている（旗がある）ときだけ出す */
export function RecordsLink({ className = "" }: { className?: string }) {
  const records = useRecords();
  if (!records || records === "error" || !records.enabled) return null;
  return (
    <Link href="/records" className={`${LINK} ${className}`}>
      記録を見る
    </Link>
  );
}

/** 1 回分。日付 → 前回のひとつと今回の発言 → うまくいった場面 → 課題が見えた場面 → 選んだひとつ → 点 */
export function RecordEntryView({ r }: { r: RecordEntry }) {
  return (
    <article>
      <h2 className={`${H2} tabular-nums`}>{formatDate(r.date)}</h2>
      <p className="mt-0.5 text-[0.86rem] text-ink-2">
        {r.otherTag ? `${r.otherTag}・` : ""}
        {r.meetingWithOther} 回目　{kindLabel(r.kind)}
      </p>

      {r.followUp && (
        <div className="mt-6">
          <p className={SUB}>前回決めたひとつと、今回現れた発言</p>
          <p className="mt-2 border-l-2 border-amber-300 pl-4 font-semibold leading-[1.7]">{r.followUp.previousAction}</p>
          {r.followUp.quotes.length > 0 && (
            <div className="mt-3">
              <RecordLines kind={r.kind} quotes={r.followUp.quotes} neighbors={r.followUp.neighbors} />
            </div>
          )}
        </div>
      )}

      {r.strength && r.strength.quotes.length > 0 && (
        <div className="mt-6">
          <p className={SUB}>{sceneTypeLabel("よく表れた所")}</p>
          <div className="mt-2">
            <RecordLines kind={r.kind} quotes={r.strength.quotes} neighbors={r.strength.neighbors} />
          </div>
        </div>
      )}

      {r.nextTry && r.nextTry.quotes.length > 0 && (
        <div className="mt-6">
          <p className={SUB}>{sceneTypeLabel("次に試せる所")}</p>
          <div className="mt-2">
            <RecordLines kind={r.kind} quotes={r.nextTry.quotes} neighbors={r.nextTry.neighbors} />
          </div>
        </div>
      )}

      {r.action && (
        <div className={`mt-6 ${SPARK_BOX}`}>
          <p className="text-xs font-semibold text-amber-900">この回に選んだひとつ</p>
          <p className="mt-1 font-semibold leading-[1.7]">{r.action.sentence}</p>
          {r.action.criterion && <p className="mt-1.5 text-[0.92rem] text-ink-2">できたかの基準：{r.action.criterion}</p>}
          {r.action.origin && <p className="mt-1.5 text-xs text-ink-3">サンプルとして置いた</p>}
        </div>
      )}

      {r.scores && <Scores s={r.scores} />}
    </article>
  );
}

/**
 * 点。引用の後ろに並べる（決まり 8。項目ごとの点はこの画面に出さない）。合計はアプリが計算したもの。
 * 続きの回は AI の合計を出さず、自分の判定と AI の判定を並べる（app/lib/record-view.mts の recordScoreCells）
 */
function Scores({ s }: { s: NonNullable<RecordEntry["scores"]> }) {
  const cells = recordScoreCells({ selfScore: s.selfScore, selfVerdict: s.selfVerdict, aiScaled: s.aiTotal.scaled, aiVerdict: s.aiVerdict });
  return (
    <div className="mt-6">
      <p className={SUB}>点</p>
      <dl className="mt-2 flex flex-wrap gap-x-10 gap-y-3 [&_dt]:text-xs [&_dt]:text-ink-3">
        {cells.map((c) => (
          <div key={c.label}>
            <dt>{c.label}</dt>
            {c.unit ? (
              <dd>
                <span className="text-xl font-semibold tabular-nums">{c.value}</span>
                <span className="text-ink-2"> {c.unit}</span>
              </dd>
            ) : (
              <dd className="text-[1.02rem] font-semibold">{c.value}</dd>
            )}
          </div>
        ))}
      </dl>
      {s.selfNote && <p className="mt-2 text-[0.92rem] text-ink-2">自分の一言：{s.selfNote}</p>}
    </div>
  );
}
