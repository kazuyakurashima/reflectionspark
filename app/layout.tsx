import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { StepNav } from "@/app/components/StepNav";

import "./globals.css";

export const metadata: Metadata = {
  title: "ReflectionSpark",
  description: "面談する側が、自分の発言を根拠に振り返り、次の一回で試す一つの行動を決める AI パートナー",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-paper text-ink">
        <header className="border-b border-line bg-paper">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-[1.2rem] font-bold tracking-tight">
              {/* 火花の印。琥珀色は「次に試すひとつ（Spark）」の色 */}
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-amber-500" aria-hidden="true">
                <path d="M12 1.5c.6 5.6 3.4 8.4 9 9v3c-5.6.6-8.4 3.4-9 9h-.01c-.6-5.6-3.4-8.4-9-9v-3c5.6-.6 8.4-3.4 9-9Z" />
              </svg>
              ReflectionSpark
            </Link>
            <Suspense fallback={null}>
              <StepNav />
            </Suspense>
          </div>
        </header>
        {children}
        <footer className="mx-auto max-w-3xl px-4 py-8 text-xs text-ink-3">
          AI（Claude）が作った材料です。点と判定には揺れがあります。文字起こしは振り返りのためだけに使い、サーバーから Anthropic の API に送ります。保存はこのブラウザの中だけです。
        </footer>
      </body>
    </html>
  );
}
