"use client";

// 画面 1・5：発言を確かめて直す。話者を入れ替える、本文を直す、元の文に戻す、カーソルの位置で分ける。元の文はいつも残す。
// 見せ方は画面 2 と同じ「島」（相手は左、本人は右）。確かめる所では、前後の会話を一度だけ並べ、確かめる発言を差し色にする。
// 前後が無いと直すかどうかを決められないため。直す前の言葉は、同じ島の中に小さく添える（二つの表を見比べさせない）。
// 印は 2 つ。太字の下線＝Claude が直した後の言葉。波線＝直す前の言葉と、意味が通らないと Claude が見た所。
// 話者を確かめる所では、話者だけを確かめる（言葉の直しと推測は、それぞれの所に出す）。押しても欄から消えず、何度でも選び直せる。

import { useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Transcript, Utterance } from "@/engine/types.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import { CHECK_EDITED_BY_USER } from "@/app/lib/view";
import { MARK_CORRECTED, MARK_SPEAKER_CHECKED, MARK_SPEAKER_LABEL, asksSpeaker, guessViews, speakerChecked, withSpeaker } from "@/app/lib/check-groups.mts";
import { refLabel } from "@/app/lib/words.mts";
import { BTN_SMALL, BTN_SMALL_PRIMARY, FIELD, QUIET_LINK, SEG, segItem } from "./ui";
import { correctionsOf } from "./UtteranceView";

/** 前後に並べる発言の数（前と後それぞれ） */
const CONTEXT = 2;
const MARK_BEFORE = "bg-transparent text-inherit underline decoration-ink-3 decoration-wavy decoration-1 underline-offset-[5px]";
const MARK_AFTER = "bg-transparent font-semibold text-inherit underline decoration-accent decoration-2 underline-offset-[5px]";
const QUIET = QUIET_LINK;

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
  /** 話者だけを確かめるカード（言葉の直しと推測は出さない） */
  const speakerOnly = ask === "speaker";
  /** 言葉を確かめるカードで、話者は「話者を確かめる所」で確かめる発言（ここでは話者を選ばせない） */
  const speakerAbove = showContext && !ask && asksSpeaker(u);
  const checked = speakerChecked(u);
  /**
   * 島の上に小さく添える印。話者の確からしさは問いの文で、聞き違いの直しは島の中の「直す前」で、本人が確かめたことは確かめた印で伝えるので、ここには出さない。
   * 話者を確かめるカードでは「話者ラベルが読めなかった」だけを迷った理由として残し、言葉を確かめるカードでは話者の印を出さない。
   */
  const flags = u.check.filter((c) => {
    if (c.startsWith("話者の確からしさ") || c === MARK_CORRECTED || c === MARK_SPEAKER_CHECKED) return false;
    if (speakerOnly) return c.startsWith(MARK_SPEAKER_LABEL);
    return !(speakerAbove && c.startsWith(MARK_SPEAKER_LABEL));
  });
  /** 本人が話者を選ぶ。同じ話者を押せば「合っている」と同じ。何度でも押し直せる */
  const setSpeaker = (speaker: string) => {
    if (speaker === u.speaker && checked) return;
    onChange(withSpeaker(u, speaker));
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
    <div className="rounded-md border border-line-2 bg-paper p-3">
      <textarea
        ref={areaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        className={`block w-full ${FIELD}`}
        aria-label={`${refLabel(u.index)} の本文`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={commitText} className={BTN_SMALL_PRIMARY}>
          この文にする
        </button>
        {onSplit && (
          <button type="button" onClick={splitHere} disabled={draft !== (u.text ?? "")} className={BTN_SMALL} title="本文の中でカーソルを置いた所で、2 つの発言に分けます">
            カーソルの位置で分ける
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(u.text ?? "");
            setEditing(false);
          }}
          className={BTN_SMALL}
        >
          やめる
        </button>
      </div>
    </div>
  );
  const guessBox = guesses.length > 0 && (
    <div className="space-y-3 rounded-md bg-accent-soft px-4 py-3 text-[0.92rem] leading-[1.7]">
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
              <button type="button" onClick={() => applyGuess(g.applied as string)} className={BTN_SMALL}>
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

  /** 前後の発言。話者を確かめるカードでは言葉の直しの印を付けない（話者だけを見る） */
  const neighbor = (n: Utterance) =>
    speakerOnly ? (
      <Bubble n={n} self={self} quiet original={null}>
        {n.text ?? n.original}
      </Bubble>
    ) : (
      <Bubble n={n} self={self} quiet original={n.text !== n.original ? marked(n.original, fixes(n).map((c) => c.before), MARK_BEFORE) : null}>
        {marked(n.text ?? n.original, fixes(n).map((c) => c.after), MARK_AFTER)}
      </Bubble>
    );

  /** 話者を確かめるカードの頭。問い → 迷った理由 → 選ぶ所。押した後も同じ所に残り、選び直せる */
  const speakerHead = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold tabular-nums">{refLabel(u.index)}</span>
        {checked && (
          <span className="inline-flex items-center gap-1 text-[0.86rem] font-semibold text-accent">
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 6.5 5 9l4.5-5.5" />
            </svg>
            確かめました
          </span>
        )}
      </div>
      <p className="mt-2 font-semibold leading-[1.7]">{checked ? `言ったのは「${u.speaker}」。` : `${refLabel(u.index)} を言ったのは「${u.speaker}」で合っていますか。`}</p>
      {!checked && (u.confidenceReason || flags.length > 0) && (
        <p className="mt-0.5 text-[0.86rem] leading-[1.7] text-ink-3">Claude が迷った理由：{u.confidenceReason || flags.join("・")}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={SEG} role="group" aria-label={`${refLabel(u.index)} を言った人`}>
          {[self, other].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeaker(s)}
              aria-pressed={u.speaker === s}
              // 確かめる前の Claude の案は淡く、本人が確かめた後は塗る
              className={checked || u.speaker !== s ? segItem(checked && u.speaker === s) : `rounded-[4px] min-h-10 px-4 text-[0.92rem] bg-accent-soft font-semibold text-ink ring-1 ring-inset ring-accent/40`}
            >
              {s}
            </button>
          ))}
        </span>
        {!checked && (
          <button type="button" onClick={() => setSpeaker(u.speaker)} className={BTN_SMALL}>
            合っている
          </button>
        )}
        <span className="text-[0.86rem] leading-[1.7] text-ink-2">{checked ? "違っていたら、押し直せます。" : `違えば［${self}｜${other}］で選び直してください。`}</span>
      </div>
    </>
  );

  return (
    <div className="rounded-md border border-line-2 px-4 py-4 sm:px-5">
      {speakerOnly ? (
        speakerHead
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-semibold tabular-nums">{refLabel(u.index)}</span>
          {speakerAbove ? (
            <span className="text-[0.86rem] text-ink-3">話者は「話者を確かめる所」で確かめます</span>
          ) : (
            <span className={SEG} role="group" aria-label={`${refLabel(u.index)} の話者`}>
              {[self, other].map((s) => (
                <button key={s} type="button" onClick={() => setSpeaker(s)} aria-pressed={u.speaker === s} className={segItem(u.speaker === s, true)}>
                  {s}
                </button>
              ))}
            </span>
          )}
          {flags.length > 0 && <span className="text-xs text-ink-3">{flags.join("・")}</span>}
        </div>
      )}
      {ask === "split" && (
        <div className="mt-3">
          <p className="font-semibold leading-[1.7]">{`${refLabel(u.index)} に、二人の言葉が混ざっていませんか。`}</p>
          <p className="mt-0.5 text-[0.86rem] leading-[1.7] text-ink-2">混ざっていれば「本文を直す」を押し、分けたい所にカーソルを置いて「カーソルの位置で分ける」。</p>
        </div>
      )}
      <ol className="mt-4 space-y-2.5">
        {before.map((n) => (
          <li key={n.index}>
            {neighbor(n)}
          </li>
        ))}
        <li>
          {editing ? (
            <>
              <Meta n={u} flags={[]} self={self} />
              {editor}
            </>
          ) : speakerOnly ? (
            <Bubble n={u} self={self} target original={null}>
              {text}
            </Bubble>
          ) : (
            <Bubble n={u} self={self} target original={u.text !== u.original ? marked(u.original, beforeMarks, MARK_BEFORE) : null} actions={actions}>
              {corrected ? marked(text, corrections.map((c) => c.after), MARK_AFTER) : marked(text, guessTargets, MARK_BEFORE)}
            </Bubble>
          )}
        </li>
        {after.map((n) => (
          <li key={n.index}>
            {neighbor(n)}
          </li>
        ))}
      </ol>
      {!speakerOnly && corrected && <p className="mt-3 text-xs text-ink-3">直しの種類：{[...new Set(corrections.map((c) => c.kind))].join("、")}</p>}
      {!speakerOnly && guessBox && <div className="mt-4">{guessBox}</div>}
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
