"use client";

// 上の帯の下に置く、一本の流れ（画面 1〜5）。番号の丸を線でつなぎ、済んだ所はチェック、今いる所は塗りにする。
// 5 は次の面談が終わってから使うので、4 と 5 の間の線だけ点線にする。狭い画面では、今いる所の名前だけを出す。

import Link from "next/link";
import { usePathname } from "next/navigation";

export const STEPS = [
  { href: "/", label: "入力" },
  { href: "/reflection", label: "読む" },
  { href: "/answers", label: "問いに答える" },
  { href: "/spark", label: "次に試すひとつ" },
  { href: "/next", label: "次の面談で" },
];

export function StepNav() {
  const pathname = usePathname();
  const now = STEPS.findIndex((s) => s.href === pathname);
  return (
    <nav aria-label="流れ">
      <ol className="flex items-center gap-2 text-[0.86rem] sm:gap-3">
        {STEPS.map((s, i) => {
          const current = i === now;
          const done = now >= 0 && i < now;
          return (
            <li key={s.href} className={`flex items-center gap-2 sm:gap-3 ${i > 0 ? "grow" : ""}`}>
              {i > 0 && <span aria-hidden="true" className={`h-0 min-w-3 grow border-t ${i === STEPS.length - 1 ? "border-dashed border-ink-3/60" : "border-line-2"}`} />}
              <Link href={s.href} aria-current={current ? "step" : undefined} className="group flex shrink-0 items-center gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums ${
                    current ? "border-accent bg-accent font-semibold text-white" : done ? "border-accent text-accent" : "border-line-2 bg-surface text-ink-3 group-hover:border-ink-3"
                  }`}
                >
                  {done ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2.5 6.5 5 9l4.5-5.5" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className={`${current ? "font-semibold text-ink" : "hidden text-ink-2 group-hover:text-ink sm:inline"}`}>
                  {done && <span className="sr-only">済み：</span>}
                  {s.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
