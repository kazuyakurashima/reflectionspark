import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "ReflectionSpark",
  description: "面談する側が、自分の発言を根拠に振り返り、次の一回で試す一つの行動を決める AI パートナー",
};

const STEPS = [
  { href: "/", label: "1 入力" },
  { href: "/reflection", label: "2 フィードバック" },
  { href: "/answers", label: "3 自分の言葉で" },
  { href: "/spark", label: "4 次に試すひとつ" },
  { href: "/next", label: "5 次の面談で" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <Link href="/" className="font-bold">
              ReflectionSpark
            </Link>
            <nav className="flex flex-wrap gap-x-3 text-xs text-stone-500">
              {STEPS.map((s) =>
                s.href ? (
                  <Link key={s.label} href={s.href} className="hover:text-stone-900">
                    {s.label}
                  </Link>
                ) : (
                  <span key={s.label}>{s.label}</span>
                ),
              )}
            </nav>
          </div>
        </header>
        {children}
        <footer className="mx-auto max-w-3xl px-4 py-8 text-xs text-stone-500">
          AI（Claude）が作った材料です。点と判定には揺れがあります。文字起こしは振り返りのためだけに使い、サーバーから Anthropic の API に送ります。保存はこのブラウザの中だけです。
        </footer>
      </body>
    </html>
  );
}
