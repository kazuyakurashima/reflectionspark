"use client";

// 画面 1・5：発言を確かめて直す。話者を入れ替える、本文を直す、元の文に戻す、カーソルの位置で分ける。元の文はいつも残す。
// 見せ方は画面 2 と同じ「島」（相手は左、本人は右）。確かめる所では、前後の会話を一度だけ並べ、確かめる発言を差し色にする。
// 前後が無いと直すかどうかを決められないため。直す前の言葉は、同じ島の中に小さく添える（二つの表を見比べさせない）。
// 印は 2 つ。太字の下線＝Claude が直した後の言葉。波線＝直す前の言葉と、意味が通らないと Claude が見た所。

import { useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Transcript, Utterance } from "@/engine/types.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import { CHECK_EDITED_BY_USER } from "@/app/lib/view";
import { MARK_CORRECTED, guessViews } from "@/app/lib/check-groups.mts";
import { refLabel } from "@/app/lib/words.mts";
import { correctionsOf } from "./UtteranceView";

/** 前後に並べる発言の数（前と後それぞれ） */
const CONTEXT = 2;
const MARK_BEFORE = "bg-transparent text-inherit underline decoration-ink-3 decoration-wavy decoration-1 underline-offset-[5px]";
const MARK_AFTER = "bg-transparent font-semibold text-inherit underline decoration-accent decoration-2 underline-offset-[5px]";
const QUIET = "text-ink-3 underline decoration-ink-3/40 underline-offset-[3px] hover:text-ink";
const SMALL_BUTTON = "min-h-9 rounded-full border border-line-2 bg-surface px-4 text-[0.86rem] hover:border-ink-2 disabled:opacity-40";

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
  /** 前後の発言を並べる（確かめる所で使う。全文では並びがそのまま見えるので要らない） */
  showContext?: boolean;
  /** この発言で本人に確かめてほしいこと（話者、区切り）。カードの先頭に出す */
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
  /** 島の上に小さく添える印。話者の確からしさは問いの文で、聞き違いの直しは島の中の「直す前」で伝えるので、ここには出さない */
  const flags = u.check.filter((c) => !c.startsWith("話者の確からしさ") && c !== MARK_CORRECTED);
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
  const text = u.text ?? `（${refLabel(u.index)} の本文は出せません）`;
  const commitText = () => {
    setEditing(false);
    if (draft === (u.text ?? "")) return;
    onChange({ ...u, text: draft, check: [...u.check.filter((c) => c !== CHECK_EDITED_BY_USER), CHECK_EDITED_BY_USER] });
  };
  const applyGuess = (applied: string) => {
    setEditing(false);
    setDraft(applied);
    onChange({ ...u, text: applied, check: [...u.check.filter((c) => c !== CHECK_EDITED_BY_USER), CHECK_EDITED_BY_USER] });
  };
  /** 前後の発言にも Claude の直しがあれば、同じ印を付ける */
  const fixes = (n: Utterance) => (n.text !== n.original ? correctionsOf(t, n.index) : []);
  const beforeMarks = [...(corrected ? corrections.map((c) => c.before) : []), ...guesses.map((g) => g.fragment)];
  const guessTargets = guesses.flatMap((g) => (g.target ? [g.target] : []));

  const actions = (
    <>
      <button type="button" onClick={() => setEditing(true)} className={QUIET}>
        本文を直す
      </button>
      {u.text !== u.original && (
        <button type="button" onClick={revertToOriginal} className={QUIET}>
          元の文に戻す
        </button>
      )}
    </>
  );
  const editor = (
    <div className="rounded-xl border border-line-2 bg-paper p-3">
      <textarea
        ref={areaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-line-2 bg-surface px-3 py-2 text-[0.95rem] leading-[1.7] focus:border-accent focus:outline-none"
        aria-label={`${refLabel(u.index)} の本文`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={commitText} className="min-h-9 rounded-full bg-accent px-4 text-[0.86rem] font-semibold text-white hover:bg-accent/90">
          この文にする
        </button>
        {onSplit && (
          <button type="button" onClick={splitHere} disabled={draft !== (u.text ?? "")} className={SMALL_BUTTON} title="本文の中でカーソルを置いた所で、2 つの発言に分けます">
            カーソルの位置で分ける
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(u.text ?? "");
            setEditing(false);
          }}
          className={`px-2 text-[0.86rem] ${QUIET}`}
        >
          やめる
        </button>
      </div>
    </div>
  );
  const guessBox = guesses.length > 0 && (
    <div className="space-y-3 rounded-lg bg-accent-soft px-4 py-3 text-[0.92rem] leading-[1.7]">
      {guesses.map((g, i) => (
        <div key={i}>
          <p>
            <span className="font-semibold">Claude の推測　</span>「<mark className={MARK_BEFORE}>{g.target ?? g.fragment}</mark>」は「<mark className={MARK_AFTER}>{g.guess}</mark>」かもしれない
            <span className="ml-1 text-xs text-ink-2">（手がかり：{g.clue}）</span>
          </p>
          {g.applied !== null ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="min-w-0 grow basis-60">
                <span className="text-xs text-ink-2">直すと　</span>
                {marked(g.applied, [g.guess], MARK_AFTER)}
              </p>
              <button type="button" onClick={() => applyGuess(g.applied as string)} className="min-h-9 shrink-0 rounded-full border border-accent px-4 text-[0.86rem] font-semibold text-accent hover:bg-white/60">
                この推測で直す
              </button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-ink-2">本文の中で置き換える場所が見つかりません。直すときは「本文を直す」で。</p>
          )}
        </div>
      ))}
      <p className="text-xs text-ink-2">推測は、「この推測で直す」を押したときだけ本文に入り、分析に使います。押さなければ今の本文のままです。</p>
    </div>
  );

  // 全文の中の一つ。並びがそのまま会話なので、島を一つだけ出す
  if (!showContext) {
    return (
      <div className="space-y-2">
        {editing ? (
          <>
            <Meta n={u} flags={flags} self={self} />
            {editor}
          </>
        ) : (
          <Bubble
            n={u}
            self={self}
            flags={flags}
            original={u.text !== u.original ? marked(u.original, beforeMarks, MARK_BEFORE) : null}
            actions={
              // 全文では、載せた発言にだけ操作を出す（128 行に並ぶと読む邪魔になる）。指で使う画面ではいつも出す
              <span className="flex gap-x-2.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <button type="button" onClick={() => setSpeaker(u.speaker === self ? other : self)} className={QUIET}>
                  話者を替える
                </button>
                {actions}
              </span>
            }
          >
            {corrected ? marked(text, corrections.map((c) => c.after), MARK_AFTER) : marked(text, guessTargets, MARK_BEFORE)}
          </Bubble>
        )}
        {guessBox}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(29,27,24,0.04)] sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-semibold tabular-nums">{refLabel(u.index)}</span>
        <span className="inline-flex rounded-full border border-line-2 bg-paper p-0.5 text-[0.86rem]" role="group" aria-label={`${refLabel(u.index)} の話者`}>
          {[self, other].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeaker(s)}
              aria-pressed={u.speaker === s}
              className={`min-h-8 rounded-full px-3.5 ${u.speaker === s ? "bg-accent font-semibold text-white" : "text-ink-2 hover:text-ink"}`}
            >
              {s}
            </button>
          ))}
        </span>
        {flags.length > 0 && <span className="text-xs text-ink-3">{flags.join("・")}</span>}
      </div>
      {ask && (
        <div className="mt-3">
          <p className="font-semibold leading-[1.7]">
            {ask === "speaker"
              ? corrected
                ? `「${u.speaker}が『${corrections.map((c) => c.after).join("…")}』と言った」で合っていますか。`
                : `${refLabel(u.index)} を言ったのは「${u.speaker}」で合っていますか。`
              : `${refLabel(u.index)} に、二人の言葉が混ざっていませんか。`}
          </p>
          <p className="mt-0.5 text-[0.86rem] leading-[1.7] text-ink-2">
            {ask === "speaker"
              ? corrected
                ? `話者が違えば上の［${self}｜${other}］で入れ替え、言葉が違えば「元の文に戻す」か「本文を直す」。合っていれば何もしなくてかまいません。`
                : `違えば、上の［${self}｜${other}］で入れ替えてください。合っていれば何もしなくてかまいません。`
              : "混ざっていれば「本文を直す」を押し、分けたい所にカーソルを置いて「カーソルの位置で分ける」。"}
            {ask === "speaker" && u.confidenceReason && <span className="text-ink-3">（Claude が迷った理由：{u.confidenceReason}）</span>}
          </p>
        </div>
      )}
      <ol className="mt-4 space-y-2.5">
        {before.map((n) => (
          <li key={n.index}>
            <Bubble n={n} self={self} quiet original={n.text !== n.original ? marked(n.original, fixes(n).map((c) => c.before), MARK_BEFORE) : null}>
              {marked(n.text ?? n.original, fixes(n).map((c) => c.after), MARK_AFTER)}
            </Bubble>
          </li>
        ))}
        <li>
          {editing ? (
            <>
              <Meta n={u} flags={[]} self={self} />
              {editor}
            </>
          ) : (
            <Bubble n={u} self={self} target original={u.text !== u.original ? marked(u.original, beforeMarks, MARK_BEFORE) : null} actions={actions}>
              {corrected ? marked(text, corrections.map((c) => c.after), MARK_AFTER) : marked(text, guessTargets, MARK_BEFORE)}
            </Bubble>
          )}
        </li>
        {after.map((n) => (
          <li key={n.index}>
            <Bubble n={n} self={self} quiet original={n.text !== n.original ? marked(n.original, fixes(n).map((c) => c.before), MARK_BEFORE) : null}>
              {marked(n.text ?? n.original, fixes(n).map((c) => c.after), MARK_AFTER)}
            </Bubble>
          </li>
        ))}
      </ol>
      {corrected && <p className="mt-3 text-xs text-ink-3">直しの種類：{[...new Set(corrections.map((c) => c.kind))].join("、")}</p>}
      {guessBox && <div className="mt-4">{guessBox}</div>}
    </div>
  );
}

/** 島の上の一行（話者・番号・印・操作） */
function Meta({ n, flags, self, actions }: { n: Utterance; flags: string[]; self: string; actions?: ReactNode }) {
  const isSelf = n.speaker === self;
  return (
    <p className={`mb-1 flex flex-wrap items-baseline gap-x-2.5 px-1 text-xs text-ink-3 ${isSelf ? "justify-end" : ""}`}>
      <span className="font-semibold text-ink-2">{n.speaker}</span>
      <span className="tabular-nums">{refLabel(n.index)}</span>
      {flags.length > 0 && <span>{flags.join("・")}</span>}
      {actions}
    </p>
  );
}

/** 発言の島。target は確かめる発言（差し色）。quiet は前後の発言（小さめ） */
function Bubble({
  n,
  self,
  target = false,
  quiet = false,
  flags = [],
  original,
  actions,
  children,
}: {
  n: Utterance;
  self: string;
  target?: boolean;
  quiet?: boolean;
  flags?: string[];
  /** 直す前の文（直しがあるときだけ） */
  original: ReactNode | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const isSelf = n.speaker === self;
  const shape = isSelf ? "rounded-2xl rounded-tr-md" : "rounded-2xl rounded-tl-md";
  const tone = target ? "bg-accent-mid text-ink shadow-[inset_4px_0_0_var(--color-accent)]" : `${isSelf ? "bg-tint-self" : "bg-tint-other"} ${quiet ? "text-ink-2" : "text-ink"}`;
  const size = target ? "px-4 py-3 text-[1.02rem] leading-[1.75]" : quiet ? "px-3.5 py-2 text-[0.92rem] leading-[1.7]" : "px-4 py-2.5 text-[0.98rem] leading-[1.75]";
  return (
    <div className={`group flex flex-col ${isSelf ? "items-end" : "items-start"}`}>
      <Meta n={n} flags={flags} self={self} actions={actions} />
      <div className={`max-w-[92%] sm:max-w-[84%] ${shape} ${tone} ${size}`}>
        <p className="whitespace-pre-wrap">{children}</p>
        {original && (
          <p className="mt-1.5 whitespace-pre-wrap border-t border-black/5 pt-1.5 text-xs leading-relaxed text-ink-2">
            <span className="text-ink-3">直す前　</span>
            {original}
          </p>
        )}
      </div>
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
