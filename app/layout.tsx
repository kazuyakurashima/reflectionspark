import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Mark } from "@/app/components/Mark";
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
        <header className="mx-auto max-w-3xl px-4 pb-7 pt-4">
          <Link href="/" className="inline-flex items-center gap-2.5 text-[1.3rem] font-bold tracking-tight">
            <Mark className="h-7 w-7" />
            ReflectionSpark
          </Link>
          <div className="mt-5">
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
