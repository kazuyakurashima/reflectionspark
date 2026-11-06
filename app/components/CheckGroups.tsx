"use client";

// 画面 1・5：確かめる所を種類ごとに出す。区切り・話者・相手の数は一つずつ、聞き違いの直しは同じ直しを 1 行にまとめ、一つずつは畳む。

import type { Transcript, Utterance } from "@/engine/types.mts";
import type { CheckGroups as Groups } from "@/app/lib/check-groups.mts";
import { refListLabel } from "@/app/lib/words.mts";
import { CheckUtterance } from "./CheckUtterance";
import { Collapsible } from "./Collapsible";

type Handlers = { onChange: (next: Utterance) => void; onSplit: (u: Utterance, pos: number) => void };

export function CheckGroups({ t, groups, onChange, onSplit, className = "" }: { t: Transcript; groups: Groups; className?: string } & Handlers) {
  return (
    <div className={`space-y-12 ${className}`}>
      <Group title="区切りが分からない所" hint="二人の言葉が一つにまとまっているかもしれません。「本文を直す」を開き、カーソルの位置で分けてください。" items={groups.unanchored} t={t} onChange={onChange} onSplit={onSplit} ask="split" />
      <Group title="話者を確かめる所" hint="講師と相手のどちらが言ったか、Claude が迷った所です。ここで見るのは話者です。聞き違いの直しが一緒に付いている発言もあります。" items={groups.speaker} t={t} onChange={onChange} onSplit={onSplit} ask="speaker" />
      <Group title="相手が 2 人以上かもしれない所" hint="相手が 2 人以上いると Claude が推定した所です。" items={groups.multiple} t={t} onChange={onChange} onSplit={onSplit} />
      <Group title="意味が通らない所" hint="Claude が意味が通らないと見て、推測を付けた所です。推測が合っていれば「この推測で直す」を押してください。押さなければ今の本文のまま読みます。" items={groups.guessed} t={t} onChange={onChange} onSplit={onSplit} />
      <Group title="そのほか" hint="" items={groups.other} t={t} onChange={onChange} onSplit={onSplit} />
      {groups.unanchored.length + groups.speaker.length + groups.multiple.length + groups.guessed.length + groups.other.length === 0 && groups.corrected.length > 0 && (
        <p className="text-[0.95rem] text-ink-2">話者・区切り・推測で確かめる所は 0 件です。</p>
      )}
      {groups.corrected.length > 0 && (
        <div>
          <GroupHead title="Claude が直した所" count={groups.corrected.length} hint="聞き違いを直した所です。同じ直しは 1 行にまとめました。一覧に目を通し、合っていれば何もしなくてかまいません。違う直しがあれば「一つずつ見る」で開いて直してください。" />
          <ul className="mt-4 space-y-1.5 text-[0.95rem] leading-[1.7]">
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
          <Collapsible label={`一つずつ見る（${groups.corrected.length} 件）`} openLabel="一つずつ見るのを閉じる" className="mt-3">
            <div className="space-y-4">
              {groups.corrected.map((u) => (
                <CheckUtterance key={u.index} t={t} u={u} onChange={onChange} onSplit={onSplit} showContext />
              ))}
            </div>
          </Collapsible>
        </div>
      )}
      {groups.edited.length > 0 && (
        <Collapsible label={`あなたが直した所（${groups.edited.length} 件）を開く`} openLabel="あなたが直した所を閉じる">
          <div className="space-y-4">
            {groups.edited.map((u) => (
              <CheckUtterance key={u.index} t={t} u={u} onChange={onChange} onSplit={onSplit} showContext />
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

function GroupHead({ title, count, hint }: { title: string; count: number; hint: string }) {
  return (
    <>
      <h3 className="flex items-baseline gap-2 font-semibold">
        {title}
        <span className="text-[0.86rem] font-normal tabular-nums text-ink-3">{count} 件</span>
      </h3>
      {hint && <p className="mt-1 text-[0.86rem] leading-[1.7] text-ink-2">{hint}</p>}
    </>
  );
}

/** 確かめる所の一つの種類。0 件なら出さない */
function Group({ title, hint, items, t, onChange, onSplit, ask }: { title: string; hint: string; items: Utterance[]; t: Transcript; ask?: "speaker" | "split" } & Handlers) {
  if (items.length === 0) return null;
  return (
    <div>
      <GroupHead title={title} count={items.length} hint={hint} />
      <div className="mt-4 space-y-4">
        {items.map((u) => (
          <CheckUtterance key={u.index} t={t} u={u} onChange={onChange} onSplit={onSplit} showContext ask={ask} />
        ))}
      </div>
    </div>
  );
}
