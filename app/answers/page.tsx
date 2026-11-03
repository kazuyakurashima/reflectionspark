"use client";

// 画面 3：自分の言葉で。問いに本人が答えを書く。AI は呼ばない。答えは次の工程（行動の候補）に渡す。

import Link from "next/link";
import { useRouter } from "next/navigation";

import { questionsOf, updateSession, useSession } from "@/app/lib/session";

export default function Screen3() {
  const router = useRouter();
  const session = useSession();
  if (session === undefined) return <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-stone-600">読み込んでいます…</main>;
  if (!session || !session.analysis) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <p className="text-sm">先に画面 2 でフィードバックを読んでください。</p>
        <Link href="/reflection" className="text-sm text-sky-800 underline">
          画面 2 へ
        </Link>
      </main>
    );
  }
  const questions = questionsOf(session);
  const answers = questions.map((q) => session.answers.find((a) => a.question === q)?.answer ?? "");
  const setAnswer = (q: string, answer: string) =>
    updateSession((s) => ({ ...s, answers: [...s.answers.filter((a) => a.question !== q), { question: q, answer }], candidates: null }));
  const answered = answers.filter((a) => a.trim() !== "").length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold">3. 自分の言葉で</h1>
      <p className="mt-1 text-sm text-stone-600">問いに、自分の言葉で答えを書きます。ここでは AI を呼びません。答えは次の画面で、行動の候補を作る材料になります。全部に答えなくてもかまいません。</p>

      <div className="mt-5 space-y-4">
        {questions.map((q, i) => (
          <section key={q} className="rounded border border-stone-200 bg-white p-4">
            <p className="text-sm">
              <span className="font-semibold">問い {i + 1}</span>　{q}
            </p>
            <textarea
              value={answers[i]}
              onChange={(e) => setAnswer(q, e.target.value)}
              rows={3}
              placeholder="自分の言葉で"
              aria-label={`問い ${i + 1} への答え`}
              className="mt-2 w-full rounded border border-stone-300 p-2 text-sm"
            />
          </section>
        ))}
        {questions.length === 0 && <p className="text-sm text-stone-600">問いがありません（根拠のある場面が無いとされました）。</p>}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button type="button" onClick={() => router.push("/spark")} className="rounded bg-sky-800 px-4 py-2 text-sm text-white">
          次へ：次に試すひとつ →
        </button>
        <span className="text-xs text-stone-500">{answered}／{questions.length} に答えた</span>
      </div>
    </main>
  );
}
