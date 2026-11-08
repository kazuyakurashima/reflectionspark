"use client";

// 項目ごとの点と合計（画面 2）。判定しない項目は目盛を出さず「判定しない」と書く。
// 行を押すと、一読で分かる説明（発言の番号なし）が開く。その下の「根拠を見る」で、発言の番号で指した理由と根拠の発言が開く（決まり 8）。
// 根拠の番号は、載せるとその発言が出て、押すと前後 2 つも開く。一読で分かる説明が無い古い結果は、番号つきの理由をそのまま出す。
// 合計はアプリが計算したもので、項目の下に置く。

import { useState } from "react";

import { RUBRIC_ITEMS, SCALE } from "@/engine/rubric.mts";
import type { ItemScore, Step2Result, Transcript } from "@/engine/types.mts";
import { RefChip, RefText } from "./RefText";
import { UtteranceContext } from "./UtteranceView";

export function ItemRow({ it, t }: { it: ItemScore; t: Transcript }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const plain = it.plain?.trim() ?? "";
  const detailId = `score-detail-${it.item}`;
  const evidence = (
    <>
      <p>
        <RefText t={t} text={it.reason} />
      </p>
      {it.utterances.length > 0 && (
        <p className="mt-2 text-xs text-ink-3">
          根拠の発言（載せると出ます。押すと前後も開きます）：
          {it.utterances.map((i) => (
            <RefChip key={i} t={t} index={i} onClick={() => setOpenIndex(openIndex === i ? null : i)} className={`mr-2 ${openIndex === i ? "font-semibold text-ink" : ""}`}>
              {i}
            </RefChip>
          ))}
        </p>
      )}
      {openIndex !== null && <UtteranceContext t={t} index={openIndex} />}
    </>
  );
  const def = RUBRIC_ITEMS.find((r) => r.n === it.item);
  return (
    <li className="border-b border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-12 w-full items-center gap-3 py-3 text-left">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 border-b-[1.5px] border-r-[1.5px] border-ink-2 transition-transform ${open ? "rotate-45" : "-rotate-45"}`} />
        <span className="grow">
          {it.item}. {def?.name}
        </span>
        {it.score === null ? (
          <span className="text-sm text-ink-3">判定しない</span>
        ) : (
          <span className="flex items-center gap-1 tabular-nums" aria-label={`${it.score} / ${SCALE.max}`}>
            {Array.from({ length: SCALE.max }, (_, i) => (
              <i key={i} className={`inline-block h-2.5 w-2.5 rounded-full ${i < (it.score ?? 0) ? "bg-ink-2" : "bg-line-2"}`} />
            ))}
            <b className="ml-2 min-w-[1.2em] text-right font-semibold">{it.score}</b>
          </span>
        )}
      </button>
      {open && (
        <div className="pb-4 pl-5 text-[0.95rem] text-ink-2">
          {plain ? (
            <>
              <p className="text-ink">
                <RefText t={t} text={plain} />
              </p>
              <button
                type="button"
                onClick={() => setDetail((d) => !d)}
                aria-expanded={detail}
                aria-controls={detailId}
                className="mt-1.5 flex min-h-9 items-center gap-2.5 text-[0.86rem] text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent"
              >
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 border-b-[1.5px] border-r-[1.5px] border-ink-2 transition-transform ${detail ? "rotate-45" : "-rotate-45"}`} />
                {detail ? "根拠を閉じる" : "根拠を見る（発言の番号つき）"}
              </button>
              {detail && (
                <div id={detailId} className="mt-1 border-l-2 border-line-2 pl-4">
                  {evidence}
                </div>
              )}
            </>
          ) : (
            evidence
          )}
        </div>
      )}
    </li>
  );
}

export function ScoreTable({ items, total, t, selfScore }: { items: ItemScore[]; total: Step2Result["total"]; t: Transcript; selfScore: number | null }) {
  return (
    <>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">
        点数は面談の点数で、人の点数ではありません。AI の点数は、同じ面談でも揺れることがあります。尺度は 1〜5（仮）。「判定しない」は 0 点ではなく、合計の分母から外します。行を押すと説明が開き、その下で根拠の発言を確かめられます。
      </p>
      <ul className="mt-2 border-t border-line">
        {items.map((it) => (
          <ItemRow key={it.item} it={it} t={t} />
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-10 gap-y-2">
        <p>
          <span className="block text-xs text-ink-3">AI の点数（合計）</span>
          <span className="text-2xl font-semibold tabular-nums">{total.scaled === null ? "—" : total.scaled}</span>
          <span className="text-ink-2"> ／10</span>
          <span className="ml-2 text-xs text-ink-3">
            判定した {total.judgedCount} 項目の {total.sum}／{total.max} を 10 点に換算（仮）
          </span>
        </p>
        {selfScore !== null && (
          <p>
            <span className="block text-xs text-ink-3">自分の点数</span>
            <span className="text-2xl font-semibold tabular-nums">{selfScore}</span>
            <span className="text-ink-2"> ／10</span>
          </p>
        )}
      </div>
      {selfScore !== null && total.scaled !== null && Math.abs(selfScore - total.scaled) >= 2 && (
        <p className="mt-2 text-sm text-ink-2">自分の点数と AI の点数に差があります。差は、どちらが正しいかではなく、確かめる所です。</p>
      )}
    </>
  );
}
