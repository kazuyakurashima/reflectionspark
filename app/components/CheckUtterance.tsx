"use client";

// 画面 1・5：発話を確かめて直す。話者を入れ替える、本文を直す、元の文に戻す、カーソルの位置で分ける。元の文はいつも残す。
// 確かめる所では、Claude の直しと推測を先に目立たせ、前後の会話（話者つき）を並べる。前後が無いと直すかどうかを決められないため。

import { useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Transcript, Utterance } from "@/engine/types.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import { CHECK_EDITED_BY_USER } from "@/app/lib/view";
import { guessViews } from "@/app/lib/check-groups.mts";
import { correctionsOf } from "./UtteranceView";

export function CheckUtterance({
  t,
  u,
  onChange,
  onSplit,
  showContext = false,
  ask,
}: {
  t: Transcript;
  u: Utterance;
  onChange: (next: Utterance) => void;
  /** カーソルの位置（コードポイント）で 2 つに分ける */
  onSplit?: (u: Utterance, pos: number) => void;
  /** 前後の発話を並べる（確かめる所で使う。全文では並びがそのまま見えるので要らない） */
  showContext?: boolean;
  /** この発話で本人に確かめてほしいこと（話者、区切り）。カードの先頭に一行で出す */
  ask?: "speaker" | "split";
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
  /** まだ本文に入っていない推測だけ（0b の直しで同じ言葉になったものは出さない） */
  const guesses = guessViews(t, u);
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
  /** 前後の発話にも Claude の直しがあれば、同じ色を付ける（直す前と直した後で見比べられるように） */
  const nb = (n: Utterance) => (n.text !== n.original ? correctionsOf(t, n.index) : []);
  const beforeMarks = [...(corrected ? corrections.map((c) => c.before) : []), ...guesses.map((g) => g.fragment)];
  const guessTargets = guesses.flatMap((g) => (g.target ? [g.target] : []));
  const actions = (
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
  );
  const editor = (
    <div className="px-2">
      <textarea
        ref={areaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        className="w-full rounded border border-stone-300 bg-white p-2 text-sm"
        aria-label={`発話 ${u.index} の本文`}
      />
      <div className="mt-1 flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={commitText} className="rounded bg-stone-800 px-3 py-1 text-white">
          この文にする
        </button>
        {onSplit && (
          <button type="button" onClick={splitHere} disabled={draft !== (u.text ?? "")} className="rounded border border-stone-300 bg-white px-3 py-1 disabled:opacity-40" title="本文の中でカーソルを置いた所で、2 つの発話に分けます">
            カーソルの位置で分ける
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(u.text ?? "");
            setEditing(false);
          }}
          className="rounded border border-stone-300 bg-white px-3 py-1"
        >
          やめる
        </button>
      </div>
    </div>
  );
  const applyGuess = (applied: string) => {
    setEditing(false);
    setDraft(applied);
    onChange({ ...u, text: applied, check: [...u.check.filter((c) => c !== CHECK_EDITED_BY_USER), CHECK_EDITED_BY_USER] });
  };
  const guessBox = guesses.length > 0 && (
    <div className="mt-1 space-y-2 rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm">
      {guesses.map((g, i) => (
        <div key={i}>
          <div>
            <span className="font-bold">推測：</span>「<mark className={MARK_BEFORE}>{g.target ?? g.fragment}</mark>」は「<mark className={MARK_AFTER}>{g.guess}</mark>」かもしれない
            <span className="ml-1 text-xs text-stone-600">（手がかり：{g.clue}）</span>
          </div>
          {g.applied !== null ? (
            <div className="mt-1 flex items-start gap-2">
              <span className="shrink-0 text-xs text-stone-600">推測で直すと：</span>
              <span className="grow">{marked(g.applied, [g.guess], MARK_AFTER)}</span>
              <button type="button" onClick={() => applyGuess(g.applied as string)} className="shrink-0 rounded bg-amber-700 px-2 py-0.5 text-xs text-white hover:bg-amber-800">
                この推測で直す
              </button>
            </div>
          ) : (
            <div className="mt-1 text-xs text-stone-600">本文の中で置き換える場所が見つかりません。直すときは「本文を直す」で。</div>
          )}
        </div>
      ))}
      <div className="text-xs text-stone-600">推測は、「この推測で直す」を押したときだけ本文に入り、分析に使います。押さなければ今の本文のままです。</div>
    </div>
  );
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
      {ask && (
        <p className="mt-2 rounded bg-sky-50 px-2 py-1 text-sm text-sky-900">
          <span className="font-bold">確かめること：</span>
          {ask === "speaker"
            ? corrected
              ? `「${u.speaker}が『${corrections.map((c) => c.after).join("…")}』と言った」で合っていますか。話者が違えば上の［${self}｜${other}］で入れ替え、言葉が違えば「元の文に戻す」か「本文を直す」。合っていれば何もしなくてかまいません。`
              : `発話 ${u.index} を言ったのは「${u.speaker}」で合っていますか。違えば、上の［${self}｜${other}］で入れ替えてください。合っていれば何もしなくてかまいません。`
            : `発話 ${u.index} に二人の言葉が混ざっていないか。混ざっていれば「本文を直す」を押し、分けたい所にカーソルを置いて「カーソルの位置で分ける」。`}
          {ask === "speaker" && u.confidenceReason && <span className="text-xs text-sky-800">（Claude が迷った理由：{u.confidenceReason}）</span>}
        </p>
      )}
      {showContext ? (
        <div className="mt-2 space-y-3">
          {corrected ? (
            <>
              <Block title="直す前（元の文字起こし）" hint="色の付いた所が、聞き違いと思われる所です（前後の発話も）。">
                {before.map((n) => (
                  <Line key={n.index} n={n} text={n.original} marks={nb(n).map((c) => c.before)} markClass={MARK_BEFORE} />
                ))}
                <Line n={u} text={u.original} target marks={beforeMarks} markClass={MARK_BEFORE} />
                {after.map((n) => (
                  <Line key={n.index} n={n} text={n.original} marks={nb(n).map((c) => c.before)} markClass={MARK_BEFORE} />
                ))}
              </Block>
              <Block title="直した後（Claude の直し）" hint={`色の付いた所が、Claude が直した所です（前後の発話も。発話 ${u.index} は${[...new Set(corrections.map((c) => c.kind))].join("、")}）。違っていたら「元の文に戻す」か「本文を直す」。`}>
                {before.map((n) => (
                  <Line key={n.index} n={n} text={n.text ?? n.original} marks={nb(n).map((c) => c.after)} markClass={MARK_AFTER} />
                ))}
                {editing ? editor : <Line n={u} text={text} target marks={corrections.map((c) => c.after)} markClass={MARK_AFTER} actions={actions} />}
                {after.map((n) => (
                  <Line key={n.index} n={n} text={n.text ?? n.original} marks={nb(n).map((c) => c.after)} markClass={MARK_AFTER} />
                ))}
              </Block>
            </>
          ) : (
            <Block title="会話" hint={guesses.length > 0 ? "色の付いた所が、意味が通らないと Claude が見た所です。" : ""}>
              {before.map((n) => (
                <Line key={n.index} n={n} text={n.text ?? n.original} marks={nb(n).map((c) => c.after)} markClass={MARK_AFTER} />
              ))}
              {editing ? editor : <Line n={u} text={text} target marks={guessTargets} markClass={MARK_BEFORE} actions={actions} />}
              {after.map((n) => (
                <Line key={n.index} n={n} text={n.text ?? n.original} marks={nb(n).map((c) => c.after)} markClass={MARK_AFTER} />
              ))}
            </Block>
          )}
          {guessBox}
        </div>
      ) : (
        <>
          {editing ? (
            <div className="mt-2">{editor}</div>
          ) : (
            <div className="mt-1 flex items-start gap-2">
              <p className="grow whitespace-pre-wrap text-sm">{corrected ? marked(text, corrections.map((c) => c.after), MARK_AFTER) : text}</p>
              {actions}
            </div>
          )}
          {guessBox}
          {u.text !== u.original && <div className="mt-1 text-xs text-stone-500">元の文字起こし：{marked(u.original, beforeMarks, MARK_BEFORE)}</div>}
        </>
      )}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-stone-700">{title}</div>
      {hint && <div className="text-xs text-stone-500">{hint}</div>}
      <div className="mt-1 space-y-0.5 rounded border border-stone-200 bg-stone-50 py-1">{children}</div>
    </div>
  );
}

/** 会話の一行。target は確かめる発話 */
function Line({ n, text, target = false, marks = [], markClass = "", actions }: { n: Utterance; text: string; target?: boolean; marks?: string[]; markClass?: string; actions?: ReactNode }) {
  return (
    <div className={`flex items-start gap-2 px-2 py-0.5 text-sm ${target ? "mx-1 rounded bg-white ring-1 ring-stone-400" : "text-stone-500"}`}>
      <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-xs">{n.index}</span>
      <span className={`w-12 shrink-0 font-semibold ${target ? "text-stone-900" : ""}`}>{n.speaker}</span>
      <span className="grow whitespace-pre-wrap">{marked(text, marks, markClass)}</span>
      {actions}
    </div>
  );
}

/** 前後に並べる発話の数（前と後それぞれ） */
const CONTEXT = 2;
const MARK_BEFORE = "rounded bg-orange-200 px-0.5 font-semibold text-stone-900";
const MARK_AFTER = "rounded bg-emerald-200 px-0.5 font-semibold text-stone-900";

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
