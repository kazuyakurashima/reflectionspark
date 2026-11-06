"use client";

// 面談の地図。発言を順に 1 本ずつの棒にして、本人は上、相手は下に、長さで並べる。AI を呼ばない。
// 番号の丸は AI が選んだ場面の位置。今読んでいる場面の範囲に、薄い帯を敷く。
// 棒にマウスを載せる（指で押す）と、その発言がその場に出る。画面は動かさない。
// 地図の下に「話題の流れ」（工程 1 の面談の流れ）を並べ、棒の下の番号と同じ番号を付ける。
// 強み・課題の色分けはしない（場面の種別は、本人が AI の見立てを開くまで出さない）。

import { useState } from "react";

import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { Transcript } from "@/engine/types.mts";
import { chapterIndexOf } from "@/app/lib/scene-view.mts";
import type { Chapter, SceneSpan } from "@/app/lib/scene-view.mts";
import { refLabel, refRangeLabel } from "@/app/lib/words.mts";

const MID = 50;
const barHeight = (text: string) => Math.min(40, 3 + Math.sqrt([...text].length) * 3);

export function Atlas({
  t,
  spans,
  current,
  chapters,
  onScene,
}: {
  t: Transcript;
  /** 場面ごとの範囲。引用が無い場面は null */
  spans: (SceneSpan | null)[];
  current: number;
  chapters: Chapter[];
  onScene: (k: number) => void;
}) {
  const n = t.utterances.length;
  const { self, other } = SPEAKER_LABELS[t.kind];
  const [hover, setHover] = useState<number | null>(null);
  const hovered = hover !== null ? t.utterances[hover] : undefined;
  const indexAt = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  return (
    <div>
      <h2 className="text-[0.95rem] font-semibold">面談の地図</h2>
      <p className="text-[0.82rem] text-ink-2">棒 1 本が 1 つの発言で、長さは話した長さです。棒にマウスを載せる（スマホでは押す）と、その発言が出ます。</p>

      <div className="mt-3 flex gap-2.5">
        {/* 縦の見出し：上が本人、下が相手（棒の向きと同じ） */}
        <div className="flex h-24 shrink-0 flex-col justify-between self-end py-3 text-xs leading-none text-ink-2" style={{ marginBottom: chapters.length > 0 ? "1.75rem" : 0 }} aria-hidden="true">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-bar-self" />
            {self}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-bar-other" />
            {other}
          </span>
        </div>

        <div className="relative min-w-0 grow pt-8">
          {spans.map((s, k) =>
            s ? (
              <button
                key={k}
                type="button"
                onClick={() => onScene(k)}
                aria-pressed={k === current}
                aria-label={`場面 ${k + 1}（${refRangeLabel(s.from, s.to)}）を下に出す`}
                style={{ left: `${((s.focal + 0.5) / n) * 100}%` }}
                className={`absolute top-0 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-[1.5px] border-accent text-xs font-semibold tabular-nums transition-colors ${
                  k === current ? "bg-accent text-white" : "bg-paper text-accent hover:bg-accent-soft"
                }`}
              >
                {k + 1}
              </button>
            ) : null,
          )}
          <svg
            viewBox={`0 0 ${n} 100`}
            preserveAspectRatio="none"
            className="block h-24 w-full cursor-pointer"
            role="img"
            aria-label={`面談の地図。${n} の発言を順に並べ、${self}は上、${other}は下に、長さを棒で示す`}
            onMouseMove={(e) => setHover(indexAt(e))}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => setHover(indexAt(e))}
          >
            {spans.map((s, k) =>
              s ? (
                <rect key={k} x={Math.max(0, s.from - 1)} y={0} width={Math.min(n, s.to + 2) - Math.max(0, s.from - 1)} height={100} className={k === current ? "fill-accent-mid" : "fill-line"} opacity={k === current ? 0.9 : 0.7} />
              ) : null,
            )}
            {hover !== null && <rect x={hover} y={0} width={1} height={100} className="fill-line-2" opacity={0.7} />}
            {chapters.slice(1).map((c) => (
              <line key={c.from} x1={c.from} y1={4} x2={c.from} y2={96} className="stroke-line-2" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={0} y1={MID} x2={n} y2={MID} className="stroke-line-2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {t.utterances.map((u) => {
              const h = barHeight(u.text ?? u.original);
              const isSelf = u.speaker === self;
              return <rect key={u.index} x={u.index + 0.16} y={isSelf ? MID - h : MID} width={0.68} height={h} className={isSelf ? "fill-bar-self" : "fill-bar-other"} />;
            })}
          </svg>
          {chapters.length > 0 && (
            <ol className="flex h-7 border-t border-line text-xs text-ink-3" aria-hidden="true">
              {chapters.map((c, k) => (
                <li key={c.from} style={{ flex: `${c.to - c.from + 1} 1 0` }} className={`min-w-0 py-1 tabular-nums ${k > 0 ? "border-l border-line pl-1.5" : ""}`}>
                  {k + 1}
                </li>
              ))}
            </ol>
          )}
          {hovered && hover !== null && (
            <div
              role="tooltip"
              style={hover < n / 2 ? { left: `${(hover / n) * 100}%` } : { right: `${(1 - (hover + 1) / n) * 100}%` }}
              className="pointer-events-none absolute top-[8.25rem] z-20 w-80 max-w-full rounded-lg border border-line-2 bg-surface px-3.5 py-2.5 text-[0.86rem] leading-[1.7] shadow-[0_10px_30px_-12px_rgba(29,27,24,0.45)]"
            >
              <p className="mb-0.5 text-xs text-ink-3">
                <span className="font-semibold text-ink-2">{hovered.speaker}</span>　{refLabel(hovered.index)}
              </p>
              <p className="whitespace-pre-wrap">{hovered.text ?? hovered.original}</p>
            </div>
          )}
        </div>
      </div>

      {chapters.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-ink-3">話題の流れ（番号は、地図の下の番号と同じです）</h3>
          <ol className="mt-1.5 space-y-1 text-[0.86rem] leading-[1.6]">
            {chapters.map((c, k) => {
              const here = spans.map((s, i) => (s && chapterIndexOf(chapters, s.focal) === k ? i : -1)).filter((i) => i >= 0);
              const now = here.includes(current);
              return (
                <li key={c.from} className={`flex items-baseline gap-2.5 ${now ? "text-ink" : "text-ink-2"}`}>
                  <span className={`w-3 shrink-0 text-right tabular-nums ${now ? "font-semibold" : ""}`}>{k + 1}</span>
                  <span className="min-w-0">
                    <span className={now ? "font-semibold" : ""}>{c.text}</span>
                    <span className="ml-1.5 whitespace-nowrap text-xs text-ink-3">{refRangeLabel(c.from, c.to)}</span>
                    {here.map((i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onScene(i)}
                        aria-pressed={i === current}
                        className={`ml-2 whitespace-nowrap rounded-full border border-accent px-2 py-px text-xs font-semibold ${i === current ? "bg-accent text-white" : "text-accent hover:bg-accent-soft"}`}
                      >
                        場面 {i + 1}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
