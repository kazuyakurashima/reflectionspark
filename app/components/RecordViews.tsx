"use client";

// 記録（Memory）から来た発話の見せ方（画面 3 の前の言葉と「この場面、前にもありました」、記録の画面）。
// 発話そのものは画面 2 と同じ部品（Island）で出し、新しい見せ方は作らない。発話の文は記録の原文のまま（決まり 1）。
// AI が書いた文（夢のまとめ、その回の AI の見立てと事実）は、画面 3 の「この場面、前にもありました」でだけ、仮説・解釈の札を付けて分けて出す（11/8 に本人が決めた）。

import Link from "next/link";
import { useState } from "react";

import type { RecordEntry } from "@/engine/memory-read.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { MeetingKind, PreviousWords, RepeatScene } from "@/engine/types.mts";
import { formatDate, kindLabel, kindOfSpeakers, linesTranscript, mergeLines, previousLines, recordScoreCells, repeatSceneView, slashDate } from "@/app/lib/record-view.mts";
import type { Line } from "@/app/lib/record-view.mts";
import { useRecords } from "@/app/lib/records";
import { dropRefs, sceneTypeLabel } from "@/app/lib/words.mts";
import { Chevron, KindBadge, MoreLink } from "./SceneParts";
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

/** 画面 3：候補に添える、前の面談での本人の言葉 */
export function PreviousWordsBlock({ p, className = "" }: { p: PreviousWords; className?: string }) {
  return (
    <div className={className}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="text-[0.86rem] font-semibold text-ink-2">
          前の面談でのあなたの言葉
          <span className="ml-2.5 font-normal tabular-nums text-ink-3">
            {slashDate(p.date)}
            {p.otherTag ? `・${p.otherTag} との面談` : ""}
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

/**
 * 画面 3「この場面、前にもありました」：今回の「次に試せる所」と同じ形の、前の面談の場面（11/8 に本人が決めた形）。
 * 上に夢のまとめ（仮説）を一度だけ。場面ごとのカードは、見出し（工程 3 が書いた、やりとりの形の 1 行）と、小さく日付と相手。
 * 押すと、その回の AI の見立て（解釈）、「事実を確認する」（その回に AI が書いた事実）、「会話を確認する」（記録の原文）が開く。
 * 前の面談の文字起こしはこの画面に無いので、AI の文の中の発話番号は外して出す。評価の言葉は付けない。
 */
export function RepeatScenesBlock({ items: raw, className = "" }: { items: (RepeatScene | PreviousWords)[]; className?: string }) {
  const items = raw.map(repeatSceneView);
  const summaries = [...new Set(items.map((p) => p.summary).filter((x): x is string => !!x))];
  return (
    <section aria-labelledby="repeat-heading" className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 id="repeat-heading" className={H2}>
          この場面、前にもありました
        </h2>
        <span className="text-xs tracking-wide text-ink-3">Memory × Dream</span>
      </div>
      <p className="mt-1 text-[0.86rem] leading-[1.7] text-ink-2">記憶（Memory）を夢（Dream）が整理して見つけた、同じ形の場面です。</p>
      {summaries.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed border-line-2 px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-ink-3">
            夢のまとめ
            <KindBadge>仮説</KindBadge>
          </p>
          {summaries.map((s) => (
            <p key={s} className="mt-1.5 text-[0.95rem] leading-[1.8] text-pretty">
              {dropRefs(s)}
            </p>
          ))}
          <p className="mt-1.5 text-[0.78rem] leading-relaxed text-ink-3">前の面談の記録から夢が立てた仮説で、確かめられたことではありません。</p>
        </div>
      )}
      <ul className="mt-3 space-y-2.5">
        {items.map((p) => (
          <li key={`${p.interviewId}｜${p.utterance}`}>
            <RepeatCard p={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 同じ形の場面のカード。押すと、その回の AI の見立て・事実・会話が開く */
function RepeatCard({ p }: { p: RepeatScene }) {
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState(false);
  const [talk, setTalk] = useState(false);
  const id = `repeat-${p.interviewId}-${p.utterance}`;
  const { self, other } = SPEAKER_LABELS[p.kind];
  const sc = p.scene;
  const factRows = sc
    ? [
        { key: "context", label: "話の流れ", bar: "bg-line-2", text: sc.context },
        { key: "observation", label: `${self}がしたこと`, bar: "bg-bar-self", text: sc.observation },
        { key: "reaction", label: `${other}の反応`, bar: "bg-bar-other", text: sc.reaction },
      ].filter((r) => r.text)
    : [];
  const t = linesTranscript(p.kind, p.lines);
  return (
    <div className={`rounded-md border bg-surface transition-colors ${open ? "border-accent shadow-[0_8px_24px_-16px_rgba(29,27,24,0.25)]" : "border-line-2 hover:border-accent"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5">
        <span className="min-w-0 flex-1">
          <span className={`block text-[1rem] font-medium leading-[1.65] text-pretty ${open ? "text-ink" : "text-accent"}`}>{p.title ?? "同じ形のやりとり"}</span>
          <span className="mt-0.5 block text-[0.8rem] tabular-nums text-ink-3">
            {slashDate(p.date)}・{p.otherTag ? `${p.otherTag} との面談` : kindLabel(p.kind)}
          </span>
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div id={id} className="border-t border-line px-4 pb-4 pt-3.5 sm:px-5">
          {sc?.reading && (
            <section aria-label="その回の AI の見立て">
              <h3 className="flex items-center gap-2 text-xs font-semibold text-ink-3">
                その回の AI の見立て
                <KindBadge>解釈</KindBadge>
              </h3>
              <p className="mt-1.5 whitespace-pre-line text-[0.98rem] leading-[1.85] text-pretty">{dropRefs(sc.reading)}</p>
            </section>
          )}
          {!sc?.reading && <p className="text-[0.86rem] leading-[1.7] text-ink-3">{sc ? "この場面について、その回の AI の見立ては記録にありません。" : "前回のひとつを確かめた所の発言で、その回の AI の見立ては記録にありません。"}</p>}
          <div className="mt-2 flex flex-col items-start gap-1">
            {factRows.length > 0 && <MoreLink open={facts} onToggle={() => setFacts((o) => !o)} label="事実を確認する" openLabel="事実を閉じる" controls={`${id}-facts`} />}
            {facts && (
              <div id={`${id}-facts`} className="mb-2 mt-1 w-full">
                <dl className="space-y-3 border-l-2 border-line-2 pl-4 text-[0.92rem] leading-[1.8]">
                  {factRows.map((r) => (
                    <div key={r.key}>
                      <dt className="flex items-center gap-2 text-[0.8rem] font-semibold text-ink-2">
                        <i aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-[2px] ${r.bar}`} />
                        {r.label}
                      </dt>
                      <dd className="whitespace-pre-line">{dropRefs(r.text ?? "")}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 pl-4 text-[0.78rem] leading-relaxed text-ink-3">その回に AI が記録に書いた事実です。言った言葉は「会話を確認する」で読めます。</p>
              </div>
            )}
            <MoreLink open={talk} onToggle={() => setTalk((o) => !o)} label="会話を確認する" openLabel="会話を閉じる" controls={`${id}-talk`} />
            {talk && (
              <div id={`${id}-talk`} className="mt-1 w-full">
                <ol className={BOX}>
                  {t.utterances.map((u) => (
                    <li key={u.index}>
                      <Island t={t} u={u} compact role={u.index === p.utterance ? "focal" : "plain"} />
                    </li>
                  ))}
                </ol>
                <p className="mt-1.5 text-[0.78rem] leading-relaxed text-ink-3">記録（Memory）にある原文です。色の付いた発言が、同じ形の場面のあなたの言葉です。</p>
              </div>
            )}
          </div>
        </div>
      )}
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
      <p className={SUB}>点数</p>
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
