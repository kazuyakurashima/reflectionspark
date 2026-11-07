"use client";

// 面談の地図。発言を順に 1 本ずつの棒にして、本人は上、相手は下に、長さで並べる。AI を呼ばない。
// 番号の丸は AI が選んだ場面の位置。今読んでいる場面の範囲に、薄い帯を敷く。
// 文字は最小限にする。棒にマウスを載せる（指で押す）とその発言が、下の「話題」の番号に載せるとその話題が、その場に出る。画面は動かさない。
// 見方の説明は既定で閉じ、見出しの横の「見方」を押したときだけ開く（毎回開くと、地図の上で読む邪魔になるため）。

import { useState } from "react";

import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { Transcript } from "@/engine/types.mts";
import type { Chapter, SceneSpan } from "@/app/lib/scene-view.mts";
import { refLabel, refRangeLabel } from "@/app/lib/words.mts";
import { BTN_SMALL } from "./ui";

const MID = 50;
const barHeight = (text: string) => Math.min(40, 3 + Math.sqrt([...text].length) * 3);
const TIP = "pointer-events-none absolute z-20 w-80 max-w-full rounded-lg border border-line-2 bg-surface px-3.5 py-2.5 text-[0.86rem] leading-[1.7] shadow-[0_10px_30px_-12px_rgba(29,27,24,0.45)]";

export function Atlas({
  t,
  spans,
  sceneNames,
  current,
  chapters,
  onScene,
}: {
  t: Transcript;
  /** 場面ごとの範囲。引用が無い場面は null */
  spans: (SceneSpan | null)[];
  /** 場面ごとの呼び名（「うまくいった場面」など） */
  sceneNames: string[];
  current: number;
  chapters: Chapter[];
  onScene: (k: number) => void;
}) {
  const n = t.utterances.length;
  const { self, other } = SPEAKER_LABELS[t.kind];
  const [hover, setHover] = useState<number | null>(null);
  const [topic, setTopic] = useState<number | null>(null);
  const [guide, setGuide] = useState(false);
  const hovered = hover !== null ? t.utterances[hover] : undefined;
  const indexAt = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  /** 左右どちらに寄せて出すか（地図の外にはみ出さないように） */
  const side = (from: number, to: number) => (from < n / 2 ? { left: `${(from / n) * 100}%` } : { right: `${(1 - (to + 1) / n) * 100}%` });
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <h2 className="text-[0.95rem] font-semibold">面談の地図</h2>
        <button type="button" onClick={() => setGuide((g) => !g)} aria-expanded={guide} aria-controls="atlas-guide" className="min-h-9 text-[0.82rem] text-ink-3 underline decoration-ink-3/40 underline-offset-[3px] hover:text-ink">
          {guide ? "見方を閉じる" : "見方"}
        </button>
      </div>

      {guide && (
        <div id="atlas-guide" className="mt-3 rounded-md bg-accent-soft px-5 py-4 text-[0.92rem] leading-[1.75]">
          <ul className="space-y-1">
            <li>
              <b className="font-semibold">棒 1 本が、1 つの発言。</b>上が{self}、下が{other}で、長いほど長く話しています。
            </li>
            <li>
              <b className="font-semibold">丸の数字が、AI の選んだ場面。</b>押すと、その場面が下に出ます。
            </li>
            <li>
              <b className="font-semibold">マウスを載せると、中身が出ます。</b>{chapters.length > 0 ? "棒ならその発言、「話題」の数字ならその話題です" : "棒に載せると、その発言です"}（スマホでは押します）。
            </li>
          </ul>
          <button type="button" onClick={() => setGuide(false)} className={`mt-3 ${BTN_SMALL}`}>
            閉じる
          </button>
        </div>
      )}

      <div className="mt-4 flex gap-3">
        {/* 縦の見出し：上が本人、下が相手（棒の向きと同じ）。その下に「話題」 */}
        <div className="shrink-0 pt-8 text-xs leading-none text-ink-2" aria-hidden="true">
          <div className="flex h-24 flex-col justify-between py-3">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-bar-self" />
              {self}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-bar-other" />
              {other}
            </span>
          </div>
          {chapters.length > 0 && <div className="flex h-8 items-center pl-4">話題</div>}
        </div>

        <div className="relative min-w-0 grow pt-8">
          {spans.map((s, k) =>
            s ? (
              <button
                key={k}
                type="button"
                onClick={() => onScene(k)}
                aria-pressed={k === current}
                aria-label={`場面 ${k + 1}：${sceneNames[k] ?? ""}（${refRangeLabel(s.from, s.to)}）を下に出す`}
                title={sceneNames[k]}
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
            {topic !== null && chapters[topic] && <rect x={chapters[topic].from} y={0} width={chapters[topic].to - chapters[topic].from + 1} height={100} className="fill-line" opacity={0.55} />}
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
            <div className="flex h-8 gap-px" role="group" aria-label="話題の区切り">
              {chapters.map((c, k) => (
                <button
                  key={c.from}
                  type="button"
                  style={{ flex: `${c.to - c.from + 1} 1 0` }}
                  onMouseEnter={() => setTopic(k)}
                  onMouseLeave={() => setTopic(null)}
                  onFocus={() => setTopic(k)}
                  onBlur={() => setTopic(null)}
                  onClick={() => setTopic(k)}
                  aria-label={`話題 ${k + 1}：${c.text}（${refRangeLabel(c.from, c.to)}）`}
                  className={`min-w-0 rounded-[3px] text-xs tabular-nums transition-colors ${topic === k ? "bg-line-2 font-semibold text-ink" : "bg-line/70 text-ink-2 hover:bg-line-2"}`}
                >
                  {k + 1}
                </button>
              ))}
            </div>
          )}
          {hovered && hover !== null && (
            <div role="tooltip" style={side(hover, hover)} className={`${TIP} top-[8.25rem]`}>
              <p className="mb-0.5 text-xs text-ink-3">
                <span className="font-semibold text-ink-2">{hovered.speaker}</span>　{refLabel(hovered.index)}
              </p>
              <p className="whitespace-pre-wrap">{hovered.text ?? hovered.original}</p>
            </div>
          )}
          {topic !== null && chapters[topic] && hover === null && (
            <div role="tooltip" style={side(chapters[topic].from, chapters[topic].to)} className={`${TIP} top-[10.4rem]`}>
              <p className="mb-0.5 text-xs text-ink-3">
                <span className="font-semibold text-ink-2">話題 {topic + 1}</span>　{refRangeLabel(chapters[topic].from, chapters[topic].to)}
              </p>
              <p>{chapters[topic].text}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
