"use client";

// 画面 1：確かめる所。最初は種類ごとの一覧（名前・一行の説明・か所の数）だけを出し、押した種類だけを開く。
// 区切り・話者・相手の数・推測は一つずつ、聞き違いの直しは同じ直しを 1 行にまとめ、一つずつは畳む。
// 話者の所では話者だけを確かめる。同じ発言の言葉の直しと推測は、「意味が通らない所」「Claude が直した所」に出す。
// 何をすればよいかの説明と、印（下線・波線）の見方は、開いた種類の中にだけ出す（一覧は短く保つ）。

import { useId, useState } from "react";
import type { ReactNode } from "react";

import type { Transcript, Utterance } from "@/engine/types.mts";
import type { CheckGroups as Groups } from "@/app/lib/check-groups.mts";
import { speakerChecked } from "@/app/lib/check-groups.mts";
import { refListLabel } from "@/app/lib/words.mts";
import { CheckUtterance } from "./CheckUtterance";
import { Collapsible } from "./Collapsible";
import { QUIET_LINK } from "./ui";

type Handlers = { onChange: (next: Utterance) => void; onSplit: (u: Utterance, pos: number) => void };

export function CheckGroups({ t, groups, onChange, onSplit, className = "" }: { t: Transcript; groups: Groups; className?: string } & Handlers) {
  const cards = (items: Utterance[], ask?: "speaker" | "split") => items.map((u) => <CheckUtterance key={u.index} t={t} u={u} onChange={onChange} onSplit={onSplit} showContext ask={ask} />);
  const sections: { key: string; title: string; summary: string; count: number; done?: number; how: string; legend: boolean; body: ReactNode }[] = [
    {
      key: "unanchored",
      title: "区切りが分からない所",
      summary: "二人の言葉が一つにまとまっているかもしれない所",
      count: groups.unanchored.length,
      how: "混ざっていれば「本文を直す」を開き、分けたい所にカーソルを置いて「カーソルの位置で分ける」を押してください。",
      legend: true,
      body: cards(groups.unanchored, "split"),
    },
    {
      key: "speaker",
      title: "話者を確かめる所",
      summary: "講師と相手のどちらが言ったか、Claude が迷った所",
      count: groups.speaker.length,
      done: groups.speaker.filter(speakerChecked).length,
      how: "合っていれば「合っている」、違えば選び直してください。押した後も選び直せます。",
      legend: false,
      body: cards(groups.speaker, "speaker"),
    },
    {
      key: "multiple",
      title: "相手が 2 人以上かもしれない所",
      summary: "相手が 2 人以上いると Claude が推定した所",
      count: groups.multiple.length,
      how: "",
      legend: true,
      body: cards(groups.multiple),
    },
    {
      key: "guessed",
      title: "意味が通らない所",
      summary: "Claude が意味を推測した所",
      count: groups.guessed.length,
      how: "推測が合っていれば「この推測で直す」を押してください。押さなければ、今の本文のまま読みます。",
      legend: true,
      body: cards(groups.guessed),
    },
    {
      key: "other",
      title: "そのほか",
      summary: "",
      count: groups.other.length,
      how: "",
      legend: true,
      body: cards(groups.other),
    },
    {
      key: "corrected",
      title: "Claude が直した所",
      summary: "聞き違いを直した所",
      count: groups.corrected.length,
      how: "同じ直しは 1 行にまとめました。合っていれば何もしなくてかまいません。違う直しがあれば「一つずつ見る」で開いて直してください。",
      legend: true,
      body: (
        <>
          <ul className="space-y-1.5 text-[0.95rem] leading-[1.7]">
            {groups.correctionGroups.map((c) => (
              <li key={`${c.before}→${c.after}`} className="flex flex-wrap items-baseline gap-x-3">
                <span>
                  <span className="text-ink-3 line-through decoration-ink-3/60">{c.before}</span>
                  <span className="mx-2 text-ink-3" aria-hidden="true">
                    →
                  </span>
                  <span className="font-semibold">{c.after}</span>
                </span>
                <span className="text-xs text-ink-3">
                  {c.indices.length} か所（{refListLabel(c.indices)}）・{c.kind}
                </span>
              </li>
            ))}
          </ul>
          <Collapsible label={`一つずつ見る（${groups.corrected.length} か所）`} openLabel="一つずつ見るのを閉じる" className="mt-3">
            <div className="space-y-4">{cards(groups.corrected)}</div>
          </Collapsible>
        </>
      ),
    },
    {
      key: "edited",
      title: "あなたが直した所",
      summary: "あなたが本文や話者を直した所",
      count: groups.edited.length,
      how: "",
      legend: true,
      body: cards(groups.edited),
    },
  ].filter((s) => s.count > 0);

  return (
    <ul className={`overflow-hidden rounded-md border border-line-2 bg-surface ${className}`}>
      {sections.map(({ key, body, ...s }) => (
        // 種類が一つだけなら、最初から開いておく（一覧を挟む意味がない）
        <Section key={key} {...s} defaultOpen={sections.length === 1}>
          {body}
        </Section>
      ))}
    </ul>
  );
}

/** 一覧の一行。押すと、その種類の確かめる所が下に開く。開いた中の終わりにも「閉じる」を置く（長く読んだあと一覧に戻れるように） */
function Section({ title, summary, count, done, how, legend, defaultOpen, children }: { title: string; summary: string; count: number; done?: number; how: string; legend: boolean; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <li className="border-b border-line-2 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        className={`flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent-soft/60 sm:px-5 ${open ? "bg-accent-soft/60" : ""}`}
      >
        <span className="min-w-0 grow">
          <span className="block font-semibold leading-snug">{title}</span>
          {summary && <span className="mt-1 block text-[0.86rem] leading-[1.6] text-ink-2">{summary}</span>}
        </span>
        <span className="shrink-0 text-right leading-snug tabular-nums">
          <span className="text-[1.05rem] font-semibold">{count}</span>
          <span className="ml-0.5 text-[0.86rem] text-ink-2">か所</span>
          {/* 確かめた数は、一つでも確かめてから出す（最初の一覧を静かに保つ） */}
          {done !== undefined && done > 0 && <span className={`mt-0.5 block text-xs ${done === count ? "font-semibold text-accent" : "text-ink-3"}`}>確かめた {done}</span>}
        </span>
        <svg viewBox="0 0 12 12" className={`h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div id={bodyId} className="border-t border-line bg-paper px-3 pb-5 pt-4 sm:px-5">
          {how && <p className="text-[0.86rem] leading-[1.7] text-ink-2">{how}</p>}
          {legend && <Legend className={how ? "mt-2" : ""} />}
          <div className={`space-y-4 ${how || legend ? "mt-4" : ""}`}>{children}</div>
          <button type="button" onClick={() => setOpen(false)} className={`mt-5 text-[0.92rem] ${QUIET_LINK}`}>
            {title}を閉じる
          </button>
        </div>
      )}
    </li>
  );
}

/** 印の見方。言葉の直しと推測を見せる種類にだけ出す */
function Legend({ className = "" }: { className?: string }) {
  return (
    <p className={`flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-3 ${className}`}>
      <span>
        <span className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-[5px]">太字の下線</span>　Claude が直した後の言葉
      </span>
      <span>
        <span className="text-ink underline decoration-ink-3 decoration-wavy decoration-1 underline-offset-[5px]">波線</span>　直す前の言葉と、意味が通らないと見た所
      </span>
    </p>
  );
}
