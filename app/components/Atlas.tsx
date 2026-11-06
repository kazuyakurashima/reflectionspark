"use client";

// 面談の地図。発話を順に 1 本ずつの棒にして、本人は上、相手は下に、長さで並べる。AI を呼ばない。
// 番号の印は AI が選んだ場面の位置。今読んでいる場面の範囲に、薄い帯を敷く。
// 強み・課題の色分けはしない（場面の種別は、本人が AI の見立てを開くまで出さない）。

import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { Transcript } from "@/engine/types.mts";
import { utteranceLabel, utteranceRangeLabel } from "@/engine/utterance-no.mts";
import { chapterIndexOf } from "@/app/lib/scene-view.mts";
import type { Chapter, SceneSpan } from "@/app/lib/scene-view.mts";

const MID = 50;
const barHeight = (text: string) => Math.min(40, 3 + Math.sqrt([...text].length) * 3);

export function Atlas({
  t,
  spans,
  current,
  chapters,
  onScene,
  onUtterance,
}: {
  t: Transcript;
  /** 場面ごとの範囲。引用が無い場面は null */
  spans: (SceneSpan | null)[];
  current: number;
  chapters: Chapter[];
  onScene: (k: number) => void;
  onUtterance: (index: number) => void;
}) {
  const n = t.utterances.length;
  const { self, other } = SPEAKER_LABELS[t.kind];
  const span = spans[current] ?? null;
  const chapter = span ? chapterIndexOf(chapters, span.focal) : -1;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[0.95rem] font-semibold">面談の地図</h2>
        <p className="flex gap-4 text-xs text-ink-2" aria-hidden="true">
          <span>
            <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] bg-bar-self align-[-1px]" />
            {self}
          </span>
          <span>
            <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] bg-bar-other align-[-1px]" />
            {other}
          </span>
        </p>
      </div>

      <div className="relative mt-2 pt-8">
        {spans.map((s, k) =>
          s ? (
            <button
              key={k}
              type="button"
              onClick={() => onScene(k)}
              aria-pressed={k === current}
              aria-label={`場面 ${k + 1}（${utteranceRangeLabel(s.from, s.to)}）を下に出す`}
              style={{ left: `${((s.focal + 0.5) / n) * 100}%` }}
              className={`absolute top-0 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-[1.5px] border-accent text-xs font-semibold tabular-nums transition-colors ${
                k === current ? "bg-accent text-white" : "bg-paper text-accent hover:bg-accent-soft"
              }`}
            >
              {k + 1}
            </button>
          ) : null,
        )}
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="block h-24 w-full" role="img" aria-label={`面談の地図。${n} の発話を順に並べ、${self}は上、${other}は下に、長さを棒で示す`}>
          {spans.map((s, k) =>
            s ? <rect key={k} x={Math.max(0, s.from - 1)} y={0} width={Math.min(n, s.to + 2) - Math.max(0, s.from - 1)} height={100} className={k === current ? "fill-accent-mid" : "fill-line"} opacity={k === current ? 0.9 : 0.7} /> : null,
          )}
          {chapters.slice(1).map((c) => (
            <line key={c.from} x1={c.from} y1={4} x2={c.from} y2={96} className="stroke-line-2" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} y1={MID} x2={n} y2={MID} className="stroke-line-2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {t.utterances.map((u) => {
            const text = u.text ?? u.original;
            const h = barHeight(text);
            const isSelf = u.speaker === self;
            return (
              <g key={u.index} onClick={() => onUtterance(u.index)} className="group cursor-pointer">
                <title>{`${utteranceLabel(u.index)}　${u.speaker}：${text}`}</title>
                <rect x={u.index} y={0} width={1} height={100} fill="transparent" />
                <rect x={u.index + 0.16} y={isSelf ? MID - h : MID} width={0.68} height={h} className={`${isSelf ? "fill-bar-self" : "fill-bar-other"} group-hover:opacity-50`} />
              </g>
            );
          })}
        </svg>
        {chapters.length > 0 && (
          <ol className="flex border-t border-line text-xs text-ink-3" aria-label="面談の流れの区切り">
            {chapters.map((c, k) => (
              <li
                key={c.from}
                style={{ flex: `${c.to - c.from + 1} 1 0` }}
                title={`${c.text}（${utteranceRangeLabel(c.from, c.to)}）`}
                className={`min-w-0 py-1 tabular-nums ${k > 0 ? "border-l border-line pl-1.5" : ""} ${k === chapter ? "font-semibold text-ink" : ""}`}
              >
                {k + 1}
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-2">
        {span && chapter >= 0 ? (
          <>
            場面 {current + 1} は、区切り {chapter + 1} の中にあります：{chapters[chapter].text}（{utteranceRangeLabel(chapters[chapter].from, chapters[chapter].to)}）
          </>
        ) : (
          <>棒 1 本が 1 つの発話で、長さは話した長さです。</>
        )}
      </p>
    </div>
  );
}
