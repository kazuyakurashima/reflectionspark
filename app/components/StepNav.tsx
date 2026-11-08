"use client";

// 上の帯の下に置く、一本の流れ（画面 1〜3）。番号の丸を線でつなぎ、済んだ所はチェック、今いる所は塗りにする。
// 面談は 1 回ごとに 1 から始める。前の面談で決めたひとつを持ち越しているときだけ、1 と 2 の間に「前回の確かめ」が入る
// （番号は持たない、小さい丸）。段の並びは app/lib/next-meeting.mts。狭い画面では、今いる所の名前だけを出す。
// 名前を出すかは、画面の幅ではなく、この帯の幅で決める（@container）。文字を大きくした端末でも、入らないときは名前を隠して丸だけにする
// （見出しが今の画面の名前を言うので、丸だけでも迷わない）。幅の境目は、丸・線・名前の幅を rem で足したもの。

import Link from "next/link";
import { usePathname } from "next/navigation";

import { flowSteps } from "@/app/lib/next-meeting.mts";
import { useSession } from "@/app/lib/session";

export function StepNav() {
  const pathname = usePathname();
  const session = useSession();
  const steps = flowSteps(Boolean(session?.prev?.spark));
  const now = steps.findIndex((s) => s.href === pathname);
  const withCheck = steps.length > 3;
  /** 今いる所の名前が入る幅（3 段：丸 5.25・線 2・すき間 2・名前 7 字で 15.3rem。確かめが入った 4 段：17.5rem） */
  const fitsCurrent = withCheck ? "@min-[18rem]:inline" : "@min-[16rem]:inline";
  /** すべての名前が入る幅（3 段：名前 11 字で 19.7rem。4 段：名前 17 字で 27.6rem） */
  const fitsAll = withCheck ? "@min-[28rem]:inline" : "@min-[20rem]:inline";
  return (
    <nav aria-label="流れ" className="@container">
      <ol className="flex items-center gap-2 text-[0.86rem] sm:gap-3">
        {steps.map((s, i) => {
          const current = i === now;
          const done = now >= 0 && i < now;
          const sub = s.n === null;
          return (
            <li key={s.href} className={`flex items-center gap-2 sm:gap-3 ${i > 0 ? "grow" : ""}`}>
              {/* 線は伸びて間を埋める。狭いときは短くなってよい（丸を押し出さない） */}
              {i > 0 && <span aria-hidden="true" className="h-0 min-w-1 grow border-t border-line-2" />}
              <Link href={s.href} aria-current={current ? "step" : undefined} aria-label={`${s.n ?? ""} ${s.label}${done ? "（済み）" : ""}`.trim()} className="group flex shrink-0 items-center gap-2">
                <span
                  className={`flex ${sub ? "h-5 w-5" : "h-7 w-7"} shrink-0 items-center justify-center rounded-full border text-xs tabular-nums ${
                    current ? "border-accent bg-accent font-semibold text-white" : done ? "border-accent text-accent" : "border-line-2 bg-surface text-ink-3 group-hover:border-ink-3"
                  }`}
                >
                  {done ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2.5 6.5 5 9l4.5-5.5" />
                    </svg>
                  ) : sub ? (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4.5 3 2 5.5 4.5 8" />
                      <path d="M2 5.5h5.5a2.5 2.5 0 0 1 0 5H6" />
                    </svg>
                  ) : (
                    s.n
                  )}
                </span>
                <span className={`hidden whitespace-nowrap ${current ? `font-semibold text-ink ${fitsCurrent}` : `text-ink-2 group-hover:text-ink ${fitsAll}`}`}>
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
