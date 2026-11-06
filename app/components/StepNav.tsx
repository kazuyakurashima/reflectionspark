"use client";

// 上の帯の、一本の流れ（画面 1〜5）。今いる画面を濃く出す。

import Link from "next/link";
import { usePathname } from "next/navigation";

export const STEPS = [
  { href: "/", label: "1 入力" },
  { href: "/reflection", label: "2 読む" },
  { href: "/answers", label: "3 自分の言葉で" },
  { href: "/spark", label: "4 次に試すひとつ" },
  { href: "/next", label: "5 次の面談で" },
];

export function StepNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="流れ" className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem]">
      {STEPS.map((s) => {
        const current = pathname === s.href;
        return (
          <Link key={s.href} href={s.href} aria-current={current ? "step" : undefined} className={current ? "font-semibold text-ink" : "text-ink-3 hover:text-ink"}>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
