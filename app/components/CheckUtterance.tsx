"use client";

// 画面 1：発話を確かめて直す。話者を入れ替える、本文を直す。元の文はいつも残す。

import { useState } from "react";

import type { Transcript, Utterance } from "@/engine/types.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import { CHECK_EDITED_BY_USER } from "@/app/lib/view";
import { correctionsOf, guessesOf } from "./UtteranceView";

export function CheckUtterance({
  t,
  u,
  onChange,
}: {
  t: Transcript;
  u: Utterance;
  onChange: (next: Utterance) => void;
}) {
  const { self, other } = SPEAKER_LABELS[t.kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(u.text ?? "");
  const guesses = guessesOf(t, u.index);
  const corrections = correctionsOf(t, u.index);
  const corrected = corrections.length > 0 && u.text !== u.original;
  const flags = u.check.filter((c) => !c.startsWith("話者の確からしさが中"));
  const setSpeaker = (speaker: string) => {
    if (speaker === u.speaker) return;
    onChange({ ...u, speaker, confidence: "高", check: [...u.check.filter((c) => !c.startsWith("話者の確からしさ")), CHECK_EDITED_BY_USER] });
  };
  const commitText = () => {
    setEditing(false);
    if (draft === (u.text ?? "")) return;
    onChange({ ...u, text: draft, check: [...u.check.filter((c) => c !== CHECK_EDITED_BY_USER), CHECK_EDITED_BY_USER] });
  };
  return (
    <div className={`rounded border px-3 py-2 ${u.confidence === "低" ? "border-amber-400 bg-amber-50" : "border-stone-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
        <span className="font-mono">{u.index}</span>
        <span className="inline-flex overflow-hidden rounded border border-stone-300">
          {[self, other].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeaker(s)}
              aria-pressed={u.speaker === s}
              className={`px-2 py-0.5 ${u.speaker === s ? "bg-stone-800 text-white" : "bg-white text-stone-700 hover:bg-stone-100"}`}
            >
              {s}
            </button>
          ))}
        </span>
        <span>確からしさ：{u.confidence}</span>
        {u.confidenceReason && <span className="text-stone-500">（{u.confidenceReason}）</span>}
        {flags.map((f) => (
          <span key={f} className="rounded bg-stone-200 px-1.5 py-0.5 text-stone-700">
            {f}
          </span>
        ))}
      </div>
      {editing ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded border border-stone-300 p-2 text-sm"
            aria-label={`発話 ${u.index} の本文`}
          />
          <div className="mt-1 flex gap-2 text-sm">
            <button type="button" onClick={commitText} className="rounded bg-stone-800 px-3 py-1 text-white">
              この文にする
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(u.text ?? "");
                setEditing(false);
              }}
              className="rounded border border-stone-300 px-3 py-1"
            >
              やめる
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-start gap-2">
          <p className="grow whitespace-pre-wrap text-sm">{u.text ?? `（発話 ${u.index} の本文は出せません）`}</p>
          <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-xs text-sky-800 hover:underline">
            本文を直す
          </button>
        </div>
      )}
      {guesses.map((g, i) => (
        <div key={i} className="mt-1 rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">
          <span className="font-semibold">推測</span>：「{g.fragment}」→「{g.guess}」（{g.clue}）。分析には使いません。
        </div>
      ))}
      {(corrected || u.text !== u.original) && <div className="mt-1 text-xs text-stone-500">元の文字起こし：{u.original}</div>}
      {corrected && <div className="text-xs text-stone-500">直した所：{corrections.map((c) => `「${c.before}」→「${c.after}」（${c.kind}）`).join("、")}</div>}
    </div>
  );
}
