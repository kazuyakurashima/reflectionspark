"use client";

// 画面 1・5：確かめる所を種類ごとに出す。区切り・話者・相手の数は一つずつ、聞き違いの直しは同じ直しを 1 行にまとめ、一つずつは畳む。

import type { Transcript, Utterance } from "@/engine/types.mts";
import type { CheckGroups as Groups } from "@/app/lib/check-groups.mts";
import { CheckUtterance } from "./CheckUtterance";
import { Collapsible } from "./Collapsible";

type Handlers = { onChange: (next: Utterance) => void; onSplit: (u: Utterance, pos: number) => void };

export function CheckGroups({ t, groups, onChange, onSplit, className = "" }: { t: Transcript; groups: Groups; className?: string } & Handlers) {
  return (
    <div className={`space-y-5 ${className}`}>
      <Group title="区切りが分からない所" hint="二人の言葉が一つにまとまっているかもしれません。「本文を直す」を開き、カーソルの位置で分けてください。" items={groups.unanchored} t={t} onChange={onChange} onSplit={onSplit} ask="split" />
      <Group title="話者を確かめる所" hint="講師と相手のどちらが言ったか、Claude が迷った所です。ここで見るのは話者です。聞き違いの直しが一緒に付いている発話もあります。" items={groups.speaker} t={t} onChange={onChange} onSplit={onSplit} ask="speaker" />
      <Group title="相手が 2 人以上かもしれない所" hint="相手が 2 人以上いると Claude が推定した所です。" items={groups.multiple} t={t} onChange={onChange} onSplit={onSplit} />
      <Group title="意味が通らない所" hint="Claude が意味が通らないと見て、推測を付けた所です。推測が合っていれば「この推測で直す」を押してください。押さなければ今の本文のまま読みます。" items={groups.guessed} t={t} onChange={onChange} onSplit={onSplit} />
      <Group title="そのほか" hint="" items={groups.other} t={t} onChange={onChange} onSplit={onSplit} />
      {groups.unanchored.length + groups.speaker.length + groups.multiple.length + groups.guessed.length + groups.other.length === 0 && groups.corrected.length > 0 && (
        <p className="text-sm text-stone-700">話者・区切り・推測で確かめる所は 0 件です。</p>
      )}
      {groups.corrected.length > 0 && (
        <div className="border-t border-stone-200 pt-4">
          <h3 className="text-base font-bold">Claude が直した所（{groups.corrected.length} 件）</h3>
          <p className="mt-0.5 text-xs text-stone-600">聞き違いを直した所です。同じ直しは 1 行にまとめました。一覧に目を通し、合っていれば何もしなくてかまいません。違う直しがあれば「一つずつ見る」で開いて直してください。</p>
          <ul className="mt-2 space-y-1 rounded border border-stone-200 bg-white px-3 py-2 text-sm">
            {groups.correctionGroups.map((c) => (
              <li key={`${c.before}→${c.after}`}>
                「<span className="text-stone-500 line-through">{c.before}</span>」→「<span className="font-semibold">{c.after}</span>」
                <span className="ml-2 text-xs text-stone-500">
                  {c.indices.length} か所（発話 {c.indices.join("、")}）・{c.kind}
                </span>
              </li>
            ))}
          </ul>
          <Collapsible label={`一つずつ見る（${groups.corrected.length} 件）`} openLabel="一つずつ見るのを閉じる" className="mt-2">
            <div className="space-y-2">
              {groups.corrected.map((u) => (
                <CheckUtterance key={u.index} t={t} u={u} onChange={onChange} onSplit={onSplit} showContext />
              ))}
            </div>
          </Collapsible>
        </div>
      )}
      {groups.edited.length > 0 && (
        <Collapsible label={`あなたが直した所（${groups.edited.length} 件）を開く`} openLabel="あなたが直した所を閉じる">
          <div className="space-y-2">
            {groups.edited.map((u) => (
              <CheckUtterance key={u.index} t={t} u={u} onChange={onChange} onSplit={onSplit} showContext />
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

/** 確かめる所の一つの種類。0 件なら出さない */
function Group({ title, hint, items, t, onChange, onSplit, ask }: { title: string; hint: string; items: Utterance[]; t: Transcript; ask?: "speaker" | "split" } & Handlers) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-bold">
        {title}（{items.length} 件）
      </h3>
      {hint && <p className="mt-0.5 text-xs text-stone-600">{hint}</p>}
      <div className="mt-2 space-y-2">
        {items.map((u) => (
          <CheckUtterance key={u.index} t={t} u={u} onChange={onChange} onSplit={onSplit} showContext ask={ask} />
        ))}
      </div>
    </div>
  );
}
