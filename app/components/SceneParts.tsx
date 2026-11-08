"use client";

// 場面の部品（画面 2 の場面と、画面 3 の「課題が見えた場面」で同じものを使う）。
// AI の見立ての文（要の一句を蛍光ペン風に）、「会話を確認する」（か所ごとに開く）、見立ての根拠の事実（根拠の発言を押すと開く）。
// 見立て・事実の文には発話番号を書かせず、番号は「会話を確認する」と「根拠の発言」に置く（11/8）。

import { useState } from "react";

import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { Scene, Transcript } from "@/engine/types.mts";
import { findUtteranceIndices } from "@/engine/utterance-no.mts";
import { refGroups, spanWindow } from "@/app/lib/scene-view.mts";
import type { SceneSpan } from "@/app/lib/scene-view.mts";
import { refRangeLabel } from "@/app/lib/words.mts";
import { RefText } from "./RefText";
import { SceneLines } from "./SceneLines";

export function Chevron({ open }: { open: boolean }) {
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 border-b-[1.5px] border-r-[1.5px] border-ink-2 transition-transform ${open ? "rotate-45" : "-rotate-45"}`} />;
}


/** 押すと開く小さなリンク（AI の見立ての中の「事実」「別の見方」） */
export function MoreLink({ open, onToggle, label, openLabel, controls }: { open: boolean; onToggle: () => void; label: string; openLabel: string; controls: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls} className="flex min-h-9 items-center gap-2.5 text-[0.9rem] text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent">
      <Chevron open={open} />
      {open ? openLabel : label}
    </button>
  );
}

/** 会話のひとまとまり（発話の範囲。含む） */
export type Spot = { from: number; to: number };

/**
 * 会話のひとまとまりを、原文で並べる箱。引用した発話に「引用」、見立てが触れた発話に印、前後 1 発話（広げると 3 発話）を添える。
 * 下に、この中の引用が原文と一致した印と「前後をもう少し読む」。
 */
export function ConversationBox({ t, scene, span, spot, pointed, pointedTag, badge }: { t: Transcript; scene: Scene; span: SceneSpan | null; spot: Spot; pointed: number[]; pointedTag?: string; badge?: string }) {
  const n = t.utterances.length;
  const [wide, setWide] = useState(false);
  const win = spanWindow(spot, n, wide ? 3 : 1);
  const quoted = (span?.quoted ?? []).filter((i) => i >= spot.from && i <= spot.to);
  // AI が最初に挙げた引用は、それがこのまとまりにあるときだけ目立たせる
  const focal = span && span.focal >= spot.from && span.focal <= spot.to ? span.focal : -1;
  const quotesIn = scene.quotes.filter((q) => q.verified && q.index >= spot.from && q.index <= spot.to).length;
  const mark = badge ?? (quotesIn > 0 ? `この会話の引用 ${quotesIn} 件は原文と一致` : "");
  return (
    <div className="rounded-md border border-line bg-surface shadow-[0_8px_24px_-16px_rgba(29,27,24,0.25)]">
      <SceneLines t={t} span={{ from: spot.from, to: spot.to, focal, quoted }} from={win.from} to={win.to} pointed={pointed} pointedTag={pointedTag} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[0.82rem] text-ink-2 sm:px-5">
        <span>
          {mark && (
            <>
              <span aria-hidden="true" className="mr-1.5 font-bold text-accent">
                ✓
              </span>
              {mark}
            </>
          )}
        </span>
        <button type="button" onClick={() => setWide((w) => !w)} aria-expanded={wide} className="min-h-9 text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent">
          {wide ? "最初の範囲に戻す" : "前後をもう少し読む"}
        </button>
      </div>
    </div>
  );
}

/** か所ごとのボタン。押すと、その会話がすぐ下に開く。いくつ開いてもよい */
export function SpotButton({ n, spot, on, onToggle, controls, note }: { n?: number; spot: Spot; on: boolean; onToggle: () => void; controls: string; note?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={on}
      aria-controls={controls}
      className={`flex min-h-9 items-center gap-2.5 rounded-md border px-3 py-1.5 text-left text-[0.9rem] transition-colors ${on ? "border-accent bg-accent-soft" : "border-line-2 bg-surface hover:border-accent"}`}
    >
      {n !== undefined && (
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent text-[0.72rem] tabular-nums text-accent">
          {n}
        </span>
      )}
      <span className="tabular-nums text-accent">{refRangeLabel(spot.from, spot.to)}</span>
      {note && <span className="text-[0.8rem] text-ink-3">{note}</span>}
      <Chevron open={on} />
    </button>
  );
}

/**
 * 「会話を確認する」。AI の見立てに関わる会話（照合済みの引用と、見立てが触れた発話）を、近いものごとのまとまりにして出す。
 * 1 か所なら、押すとその会話が開く。何か所かあれば、押すとか所ごとのボタンが並び、ボタンごとに会話が開く（11/8 に本人が決めた）。
 */
export function ConversationLink({ t, scene, span, pointed }: { t: Transcript; scene: Scene; span: SceneSpan | null; pointed: number[] }) {
  const n = t.utterances.length;
  const spots = refGroups([...(span?.quoted ?? []), ...pointed], n);
  const [open, setOpen] = useState(false);
  const [openSpots, setOpenSpots] = useState<number[]>([]);
  const id = `talk-${scene.type}`;
  const verified = scene.quotes.length;
  const discarded = scene.discardedQuotes.length;
  if (spots.length === 0) return <p className="text-ink-2">この場面には、原文と一致した引用がありません。</p>;
  const whole = discarded === 0 ? `引用 ${verified} 件すべて原文と一致` : `引用 ${verified}／${verified + discarded} 件が原文と一致（一致しない引用は出していません）`;
  const label = spots.length === 1 ? `会話を確認する（${refRangeLabel(spots[0].from, spots[0].to)}）` : `会話を確認する（${spots.length} か所）`;
  return (
    <div>
      <MoreLink open={open} onToggle={() => setOpen((o) => !o)} label={label} openLabel="会話を閉じる" controls={id} />
      {open && (
        <div id={id} className="mt-2">
          {spots.length === 1 ? (
            <ConversationBox t={t} scene={scene} span={span} spot={spots[0]} pointed={pointed} badge={verified > 0 ? whole : undefined} />
          ) : (
            <>
              <p className="text-[0.86rem] leading-[1.75] text-ink-2">
                AI の見立てに関わる会話が {spots.length} か所あります。押すと、その会話が開きます。{verified > 0 && `${whole}。`}
              </p>
              <ol className="mt-2.5 space-y-2.5">
                {spots.map((sp, i) => {
                  const on = openSpots.includes(i);
                  const hasQuote = (span?.quoted ?? []).some((q) => q >= sp.from && q <= sp.to);
                  return (
                    <li key={sp.from}>
                      <SpotButton n={i + 1} spot={sp} on={on} onToggle={() => setOpenSpots((o) => (on ? o.filter((x) => x !== i) : [...o, i]))} controls={`${id}-${i}`} note={hasQuote ? "引用あり" : "見立てが触れた発言"} />
                      {on && (
                        <div id={`${id}-${i}`} className="mt-2">
                          <ConversationBox t={t} scene={scene} span={span} spot={sp} pointed={pointed} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-3">{MATCH_NOTE}</p>
        </div>
      )}
    </div>
  );
}

/** 事実の文の後に置く「根拠の発言」。番号のまとまりごとのボタンで、押すとその会話がすぐ下に開く */
export function RefSpots({ t, scene, span, indices, idPrefix }: { t: Transcript; scene: Scene; span: SceneSpan | null; indices: number[]; idPrefix: string }) {
  const spots = refGroups(indices, t.utterances.length);
  const [openSpots, setOpenSpots] = useState<number[]>([]);
  if (spots.length === 0) return null;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[0.8rem] text-ink-3">根拠の発言：</span>
        {spots.map((sp, i) => {
          const on = openSpots.includes(i);
          return <SpotButton key={sp.from} spot={sp} on={on} onToggle={() => setOpenSpots((o) => (on ? o.filter((x) => x !== i) : [...o, i]))} controls={`${idPrefix}-${i}`} />;
        })}
      </div>
      {spots.map((sp, i) =>
        openSpots.includes(i) ? (
          <div key={sp.from} id={`${idPrefix}-${i}`} className="mt-2">
            <ConversationBox t={t} scene={scene} span={span} spot={sp} pointed={indices} pointedTag="根拠の発言" />
          </div>
        ) : null,
      )}
    </div>
  );
}

/**
 * 文字起こしから確かめられること（講師がしたこと・相手の反応）。AI が書いた事実。
 * 文の中には発話番号を書かせず、根拠の発言は文の後にボタンで置く（11/8）。前の作りの出力は、文の中の番号を押すと発言が開く。
 * AI が箇条書きで書いた改行は残す（一続きにすると「- 」が文の中に並んで読めない）。
 */
export function Facts({ t, scene, span, id }: { t: Transcript; scene: Scene; span: SceneSpan | null; id: string }) {
  const { self, other } = SPEAKER_LABELS[t.kind];
  const rows = [
    { key: "observation", label: `${self}がしたこと`, bar: "bg-bar-self", text: scene.observation, refs: scene.refs?.observation },
    { key: "reaction", label: `${other}の反応`, bar: "bg-bar-other", text: scene.reaction, refs: scene.refs?.reaction },
  ];
  return (
    <div id={id} className="mb-2 mt-1 w-full">
      <dl className="space-y-4 border-l-2 border-line-2 pl-4 text-[0.95rem] leading-[1.8]">
        {rows.map((r) => (
          <div key={r.key}>
            <dt className="flex items-center gap-2 text-[0.8rem] font-semibold text-ink-2">
              <i aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-[2px] ${r.bar}`} />
              {r.label}
            </dt>
            <dd className="whitespace-pre-line">
              {r.text ? <RefText t={t} text={r.text} /> : "（書かれていません）"}
              {r.refs && <RefSpots t={t} scene={scene} span={span} indices={r.refs} idPrefix={`${id}-${r.key}`} />}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 pl-4 text-[0.8rem] leading-relaxed text-ink-3">
        {scene.refs ? "AI が文字起こしから書いた事実です。「根拠の発言」を押すと、その会話が開きます。" : "AI が文字起こしから書いた事実です。番号を押すと、その発言が開きます。"}
      </p>
    </div>
  );
}

/**
 * AI の見立ての文。要の一句（AI が見立ての文から写して返したもの）を、蛍光ペン風に目立たせる（11/8 に本人が決めた）。
 * 句が文にそのまま無いとき（前の作りの出力も）は、目立たせずにそのまま出す。
 */
export function ReadingText({ t, text, keyPhrase }: { t: Transcript; text: string; keyPhrase: string | null }) {
  const i = keyPhrase ? text.indexOf(keyPhrase) : -1;
  if (!keyPhrase || i < 0) return <RefText t={t} text={text} />;
  return (
    <>
      <RefText t={t} text={text.slice(0, i)} />
      <mark className="key-mark">
        <RefText t={t} text={keyPhrase} />
      </mark>
      <RefText t={t} text={text.slice(i + keyPhrase.length)} />
    </>
  );
}

export const MATCH_NOTE = "「引用は原文と一致」は、引用が文字起こしのとおりであることの印で、AI の読みが合っていることの印ではありません。";

/** 文の種類の札（「解釈」「仮説」）。AI が書いた文を、事実と分けて見せる */
export function KindBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[3px] border border-line-2 px-1.5 py-px text-[0.7rem] font-semibold leading-tight text-ink-3">{children}</span>;
}

/** 見立てが触れた発話。新しい出力は欄に分けてある。前の作りの出力は、文の中の番号を読む */
export function pointedOf(scene: Scene): number[] {
  return scene.refs ? scene.refs.reading : findUtteranceIndices(scene.reading);
}

/** 「AI の見立て」（解釈の札）と、見立ての文（要の一句を目立たせる） */
export function SceneReading({ t, scene, textClass = "text-[1.08rem] leading-[1.85]" }: { t: Transcript; scene: Scene; textClass?: string }) {
  return (
    <section aria-label="AI の見立て">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-ink-3">
        AI の見立て
        <KindBadge>解釈</KindBadge>
      </h3>
      <p className={`mt-1.5 whitespace-pre-line text-pretty ${textClass}`}>{scene.reading ? <ReadingText t={t} text={scene.reading} keyPhrase={scene.readingKey ?? null} /> : "（書かれていません）"}</p>
    </section>
  );
}
