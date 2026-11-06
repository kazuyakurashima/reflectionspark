"use client";

// 発言の番号の印。マウスを載せる・キーで選ぶ・指で押すと、その発言（話者と本文）がその場に小さく出る。
// 画面を上下に動かさずに、番号が指す発言を確かめられるようにする。出す本文は整形後の発話そのまま（アプリが番号から取る。決まり 1）。
// RefText は、AI が書いた文の中の「発話 n」を「発言 n」と読み替えて、この印にする（app/lib/words.mts）。

import { useRef, useState } from "react";

import type { Transcript } from "@/engine/types.mts";
import { tooltipPlace } from "@/app/lib/tooltip-place.mts";
import { refLabel, splitRefs } from "@/app/lib/words.mts";

export function RefChip({
  t,
  index,
  children,
  onClick,
  className = "",
}: {
  t: Transcript;
  index: number;
  children: React.ReactNode;
  /** 押したときにすること（無ければ、押すたびに出す・しまう） */
  onClick?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ width: 320, shift: 0, below: false });
  const ref = useRef<HTMLSpanElement>(null);
  /** 押し始めた時に開いていたか。指で押すと、押す前にフォーカスで開くので、押した時の様子で「閉じる」かを決める */
  const openAtPress = useRef(false);
  const u = t.utterances[index];
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPlace({ ...tooltipPlace(r.left, document.documentElement.clientWidth), below: r.top < 200 });
    setOpen(true);
  };
  const toggle = (e: React.MouseEvent) => {
    // キーボードで押したとき（detail が 0）は、押し始めが無いので今の様子で決める
    const wasOpen = e.detail === 0 ? open : openAtPress.current;
    if (wasOpen) setOpen(false);
    else show();
  };
  return (
    <span ref={ref} className="relative inline-block" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onFocus={show}
        onBlur={() => setOpen(false)}
        onPointerDown={() => {
          openAtPress.current = open;
        }}
        onClick={onClick ?? toggle}
        className={`tabular-nums text-accent underline decoration-accent/50 decoration-dotted underline-offset-[4px] hover:decoration-accent hover:decoration-solid ${className}`}
      >
        {children}
      </button>
      {open && u && (
        <span
          role="tooltip"
          style={{ width: place.width, left: place.shift }}
          className={`absolute z-30 block rounded-lg border border-line-2 bg-surface px-3.5 py-2.5 text-left text-[0.86rem] font-normal leading-[1.7] text-ink shadow-[0_10px_30px_-12px_rgba(29,27,24,0.45)] ${
            place.below ? "top-full mt-1.5" : "bottom-full mb-1.5"
          }`}
        >
          <span className="mb-0.5 block text-xs text-ink-3">
            <span className="font-semibold text-ink-2">{u.speaker}</span>　{refLabel(u.index)}
          </span>
          <span className="block whitespace-pre-wrap">{u.text ?? u.original}</span>
        </span>
      )}
    </span>
  );
}

/** AI が書いた文。文の中の発言の番号に、その発言が出る印を付ける */
export function RefText({ t, text }: { t: Transcript; text: string }) {
  return (
    <>
      {splitRefs(text, t.utterances.length).map((p, i) =>
        p.index === undefined ? (
          <span key={i}>{p.text}</span>
        ) : (
          <RefChip key={i} t={t} index={p.index}>
            {p.text}
          </RefChip>
        ),
      )}
    </>
  );
}
