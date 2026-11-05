"use client";

// 画面 1・5：発話を確かめて直す。話者を入れ替える、本文を直す、元の文に戻す、カーソルの位置で分ける。元の文はいつも残す。
// 確かめる所では、Claude の直しと推測を先に目立たせ、前後の会話（話者つき）を並べる。前後が無いと直すかどうかを決められないため。

import { useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Transcript, Utterance } from "@/engine/types.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import { CHECK_EDITED_BY_USER } from "@/app/lib/view";
import { correctionsOf, guessesOf } from "./UtteranceView";

export function CheckUtterance({
  t,
  u,
  onChange,
  onSplit,
  showContext = false,
}: {
  t: Transcript;
  u: Utterance;
  onChange: (next: Utterance) => void;
  /** カーソルの位置（コードポイント）で 2 つに分ける */
  onSplit?: (u: Utterance, pos: number) => void;
  /** 前後の発話を並べる（確かめる所で使う。全文では並びがそのまま見えるので要らない） */
  showContext?: boolean;
}) {
  const { self, other } = SPEAKER_LABELS[t.kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(u.text ?? "");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const splitHere = () => {
    const el = areaRef.current;
    if (!el || !onSplit) return;
    if (draft !== (u.text ?? "")) return; // 本文を直している途中は、先に「この文にする」
    const pos = [...draft.slice(0, el.selectionStart)].length;
    setEditing(false);
    onSplit(u, pos);
  };
  const guesses = guessesOf(t, u.index);
  const corrections = correctionsOf(t, u.index);
  const corrected = corrections.length > 0 && u.text !== u.original;
  const flags = u.check.filter((c) => !c.startsWith("話者の確からしさが中"));
  const setSpeaker = (speaker: string) => {
    if (speaker === u.speaker) return;
    onChange({ ...u, speaker, confidence: "高", check: [...u.check.filter((c) => !c.startsWith("話者の確からしさ")), CHECK_EDITED_BY_USER] });
  };
  const revertToOriginal = () => {
    setEditing(false);
    setDraft(u.original);
    onChange({ ...u, text: u.original, check: [...u.check.filter((c) => c !== CHECK_EDITED_BY_USER), CHECK_EDITED_BY_USER] });
  };
  const before = showContext ? t.utterances.slice(Math.max(0, u.index - CONTEXT), u.index) : [];
  const after = showContext ? t.utterances.slice(u.index + 1, u.index + 1 + CONTEXT) : [];
  const text = u.text ?? `（発話 ${u.index} の本文は出せません）`;
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
      {(corrected || guesses.length > 0) && (
        <div className="mt-2 space-y-1 rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm">
          {corrected &&
            corrections.map((c, i) => (
              <div key={`c${i}`}>
                <span className="font-bold">Claude が直した：</span>「<mark className={MARK_BEFORE}>{c.before}</mark>」→「<mark className={MARK_AFTER}>{c.after}</mark>」
                <span className="ml-1 text-xs text-stone-600">（{c.kind}）</span>
              </div>
            ))}
          {guesses.map((g, i) => (
            <div key={`g${i}`}>
              <span className="font-bold">推測：</span>「<mark className={MARK_BEFORE}>{g.fragment}</mark>」→「<mark className={MARK_AFTER}>{g.guess}</mark>」
              <span className="ml-1 text-xs text-stone-600">手がかり：{g.clue}。推測は分析には使いません。</span>
            </div>
          ))}
        </div>
      )}
      <div className={showContext ? "mt-2 space-y-1" : ""}>
        {before.map((n) => (
          <ContextLine key={n.index} n={n} />
        ))}
        {editing ? (
          <div className="mt-2">
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full rounded border border-stone-300 p-2 text-sm"
              aria-label={`発話 ${u.index} の本文`}
            />
            <div className="mt-1 flex flex-wrap gap-2 text-sm">
              <button type="button" onClick={commitText} className="rounded bg-stone-800 px-3 py-1 text-white">
                この文にする
              </button>
              {onSplit && (
                <button type="button" onClick={splitHere} disabled={draft !== (u.text ?? "")} className="rounded border border-stone-300 px-3 py-1 disabled:opacity-40" title="本文の中でカーソルを置いた所で、2 つの発話に分けます">
                  カーソルの位置で分ける
                </button>
              )}
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
          <div className={`flex items-start gap-2 ${showContext ? "rounded bg-white px-2 py-1 ring-1 ring-stone-300" : "mt-1"}`}>
            {showContext && <span className="shrink-0 pt-0.5 text-xs font-bold text-stone-700">▶ {u.speaker}</span>}
            <p className="grow whitespace-pre-wrap text-sm">{corrected ? marked(text, corrections.map((c) => c.after), MARK_AFTER) : text}</p>
            <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
              <button type="button" onClick={() => setEditing(true)} className="text-sky-800 hover:underline">
                本文を直す
              </button>
              {u.text !== u.original && (
                <button type="button" onClick={revertToOriginal} className="text-sky-800 hover:underline">
                  元の文に戻す
                </button>
              )}
            </span>
          </div>
        )}
        {after.map((n) => (
          <ContextLine key={n.index} n={n} />
        ))}
      </div>
      {(corrected || u.text !== u.original || guesses.length > 0) && (
        <div className="mt-1 text-xs text-stone-500">
          元の文字起こし：{marked(u.original, [...(corrected ? corrections.map((c) => c.before) : []), ...guesses.map((g) => g.fragment)], MARK_BEFORE)}
        </div>
      )}
    </div>
  );
}

/** 前後に並べる発話の数（前と後それぞれ） */
const CONTEXT = 2;
const MARK_BEFORE = "rounded bg-stone-200 px-0.5 text-stone-700 line-through decoration-stone-400";
const MARK_AFTER = "rounded bg-yellow-200 px-0.5 font-semibold text-stone-900";

function ContextLine({ n }: { n: Utterance }) {
  return (
    <div className="flex gap-2 px-2 text-xs text-stone-500">
      <span className="shrink-0 font-mono">{n.index}</span>
      <span className="shrink-0 font-semibold">{n.speaker}</span>
      <span className="whitespace-pre-wrap">{n.text ?? n.original}</span>
    </div>
  );
}

/** 文の中の needles に印を付ける（最初に見つかった所から順に。長いものを先に当てる） */
function marked(text: string, needles: string[], className: string): ReactNode {
  const ns = [...new Set(needles.filter((n) => n.length > 0))].sort((a, b) => b.length - a.length);
  if (ns.length === 0) return text;
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let at = -1;
    let hit = "";
    for (const n of ns) {
      const p = text.indexOf(n, i);
      if (p >= 0 && (at < 0 || p < at)) {
        at = p;
        hit = n;
      }
    }
    if (at < 0) {
      out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={out.length} className={className}>
        {hit}
      </mark>,
    );
    i = at + hit.length;
  }
  return out;
}
