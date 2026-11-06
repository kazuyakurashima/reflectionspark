"use client";

// 押すと開く所。既定で閉じる。開いた所は勝手に閉じず、閉じた所は勝手に開かない（親の再描画で状態を失わない）。

import { useState } from "react";

export function Collapsible({
  label,
  openLabel,
  children,
  className = "",
  defaultOpen = false,
}: {
  label: string;
  /** 開いたときのラベル。無ければ閉じるためのラベルは「閉じる」 */
  openLabel?: string;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-[0.92rem] text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent"
      >
        {open ? (openLabel ?? "閉じる") : label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** 「続きを読む」：最初の一文を消して全文を出す。同じ文を二度見せない。 */
export function ReadMore({ first, rest }: { first: string; rest: string }) {
  const [open, setOpen] = useState(false);
  if (!rest) return <p>{first}</p>;
  if (open) return <p>{`${first}${rest}`}</p>;
  return (
    <p>
      {first}{" "}
      <button type="button" onClick={() => setOpen(true)} className="text-[0.92rem] text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent">
        続きを読む
      </button>
    </p>
  );
}
