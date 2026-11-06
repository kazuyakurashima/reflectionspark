"use client";

// 発話の見せ方。発話を話者ごとの「島」にして並べる（相手は左で暖色の薄い地、本人は右で寒色の薄い地）。
// 話者の色分けは色味をごく弱くし、差し色（青緑）は目立たせる発言だけに使う。大きさと太さも変えて、色だけに頼らない。
// 工程 0 で直した所・推測がある発話には、「元の文字起こしを見る」を小さく添え、押すと元の文・直した所・推測が開く
// （推測は分析に使っていないと書く）。

import { useState } from "react";

import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { Transcript, Utterance } from "@/engine/types.mts";
import { utteranceLabel } from "@/engine/utterance-no.mts";
import { around } from "@/app/lib/view";

export function guessesOf(t: Transcript, index: number) {
  return (t.step0c?.guesses ?? []).filter((g) => g.index === index);
}

export function correctionsOf(t: Transcript, index: number) {
  return t.step0b.applied.filter((c) => c.index === index);
}

/** focal：AI が最初に引用した発言。quoted：ほかの引用。context：「前後をもう少し読む」で足した、離れた発話（少し淡く）。plain：直前・直後の発話と、全発話の中のふつうの発話 */
export type LineRole = "focal" | "quoted" | "context" | "plain";

/** 発話の「島」一つ。場面のやりとり、全発話、根拠の発話の前後で使う。compact は小さめの字 */
export function Island({ t, u, role, tag, compact = false }: { t: Transcript; u: Utterance; role: LineRole; tag?: string; compact?: boolean }) {
  const isSelf = u.speaker === SPEAKER_LABELS[t.kind].self;
  const guesses = guessesOf(t, u.index);
  const corrections = correctionsOf(t, u.index);
  const corrected = corrections.length > 0 && u.text !== u.original;
  const hasNote = guesses.length > 0 || u.text !== u.original;
  const [noteOpen, setNoteOpen] = useState(false);
  const shape = isSelf ? "rounded-2xl rounded-tr-md" : "rounded-2xl rounded-tl-md";
  const tone =
    role === "focal"
      ? "bg-accent-mid text-ink shadow-[inset_4px_0_0_var(--color-accent)]"
      : `${isSelf ? "bg-tint-self" : "bg-tint-other"} ${role === "context" ? "text-ink-2" : "text-ink"}`;
  const size = compact
    ? `px-3.5 py-2 text-[0.95rem] leading-[1.7] ${role === "focal" ? "font-medium" : ""}`
    : role === "focal"
      ? "px-5 py-3.5 text-[1.12rem] font-medium leading-[1.75]"
      : "px-4 py-2.5 leading-[1.8]";
  return (
    <div className={`flex flex-col ${isSelf ? "items-end" : "items-start"}`}>
      <p className="mb-1 flex items-baseline gap-2 px-1 text-xs text-ink-3">
        <span className="font-semibold text-ink-2">{u.speaker}</span>
        <span className="tabular-nums">{utteranceLabel(u.index)}</span>
        {tag && <span className={role === "focal" ? "font-semibold text-accent" : ""}>{tag}</span>}
      </p>
      <div className={`max-w-[90%] sm:max-w-[84%] ${shape} ${tone} ${size}`}>
        <p className="whitespace-pre-wrap">{u.text ?? `（${utteranceLabel(u.index)} の本文は出せません）`}</p>
        {hasNote && (
          <div className="mt-1.5 text-xs font-normal leading-relaxed text-ink-2">
            <button type="button" onClick={() => setNoteOpen((o) => !o)} aria-expanded={noteOpen} className="text-ink-3 underline decoration-ink-3/40 underline-offset-[3px] hover:text-ink-2">
              {noteOpen ? "元の文字起こしを閉じる" : "元の文字起こしを見る"}
            </button>
            {noteOpen && (
              <div className="mt-1 border-t border-black/5 pt-1.5">
                <p>元の文字起こし：{u.original}</p>
                {corrected && <p>直した所：{corrections.map((c) => `「${c.before}」→「${c.after}」`).join("、")}</p>}
                {guesses.map((g, i) => (
                  <p key={i}>
                    推測：「{g.fragment}」→「{g.guess}」（{g.clue}）。この推測は分析には使っていません。
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 根拠の発話と前後 2 発話。画面 2・5 で根拠の発話番号を押したときに、その場で開く */
export function UtteranceContext({ t, index }: { t: Transcript; index: number }) {
  return (
    <ol className="mt-2 space-y-2.5 rounded-md border border-line bg-surface px-3 py-3.5 text-ink sm:px-4">
      {around(t, index).map((u) => (
        <li key={u.index}>
          <Island t={t} u={u} compact role={u.index === index ? "focal" : "plain"} tag={u.index === index ? "根拠の発話" : undefined} />
        </li>
      ))}
    </ol>
  );
}
