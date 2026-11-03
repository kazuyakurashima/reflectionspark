"use client";

// 項目ごとの点と合計（画面 2・5 で同じ見せ方）。判定しない項目は目盛を出さず「判定しない」と書く。
// 理由の一行と根拠の発話は押すと開く。合計はアプリが計算したもの（決まり 8）。

import { useState } from "react";

import { RUBRIC_ITEMS, SCALE } from "@/engine/rubric.mts";
import type { ItemScore, Step2Result, Transcript } from "@/engine/types.mts";
import { Collapsible } from "./Collapsible";
import { UtteranceContext } from "./UtteranceView";

export function ItemRow({ it, t }: { it: ItemScore; t: Transcript }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const def = RUBRIC_ITEMS.find((r) => r.n === it.item);
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="w-44 shrink-0">
          {it.item}. {def?.name}
        </span>
        {it.score === null ? (
          <span className="text-stone-600">判定しない</span>
        ) : (
          <span className="flex items-center gap-1" aria-label={`${it.score} / ${SCALE.max}`}>
            {Array.from({ length: SCALE.max }, (_, i) => (
              <span key={i} className={`inline-block h-3 w-3 rounded-full ${i < (it.score ?? 0) ? "bg-stone-700" : "bg-stone-200"}`} />
            ))}
            <span className="ml-1">{it.score}</span>
          </span>
        )}
      </div>
      <Collapsible label="理由と根拠の発話を開く" className="mt-1">
        <p className="text-sm">{it.reason}</p>
        {it.utterances.length > 0 && (
          <p className="mt-1 text-xs text-stone-500">
            根拠の発話：
            {it.utterances.map((i) => (
              <button key={i} type="button" onClick={() => setOpenIndex(openIndex === i ? null : i)} className="mr-2 text-sky-800 hover:underline">
                {i}
              </button>
            ))}
          </p>
        )}
        {openIndex !== null && <UtteranceContext t={t} index={openIndex} />}
      </Collapsible>
    </div>
  );
}

export function ScoreTable({ items, total, t, selfScore }: { items: ItemScore[]; total: Step2Result["total"]; t: Transcript; selfScore: number | null }) {
  return (
    <>
      <p className="mt-1 text-xs text-stone-500">点は面談の点で、人の点ではありません。尺度は 1〜5（仮）。「判定しない」は 0 点ではなく、合計の分母から外します。</p>
      <div className="mt-2 divide-y divide-stone-200 rounded border border-stone-200 bg-white">
        {items.map((it) => (
          <ItemRow key={it.item} it={it} t={t} />
        ))}
      </div>
      <p className="mt-2 text-sm">
        合計：<span className="font-semibold">{total.scaled === null ? "—" : `${total.scaled}／10`}</span>
        <span className="ml-1 text-xs text-stone-500">
          （判定した {total.judgedCount} 項目の {total.sum}／{total.max} を 10 点に換算。仮）
        </span>
        {selfScore !== null && (
          <span className="ml-3">
            自分の点：<span className="font-semibold">{selfScore}／10</span>
          </span>
        )}
      </p>
      {selfScore !== null && total.scaled !== null && Math.abs(selfScore - total.scaled) >= 2 && (
        <p className="mt-1 text-xs text-stone-600">自分の点と AI の点に差があります。差は、どちらが正しいかではなく、確かめる点です。</p>
      )}
    </>
  );
}
