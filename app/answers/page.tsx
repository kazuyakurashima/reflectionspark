"use client";

// 画面 3：問いに答える（文書での名前は「自分の言葉で」）。問いに本人が答えを書く。AI は呼ばない。答えは次の工程（行動の候補）に渡す。
// 問いの中の発言の番号は、載せるとその発言が出る（app/components/RefText.tsx）。

import Link from "next/link";
import { useRouter } from "next/navigation";

import { RefText } from "@/app/components/RefText";
import { BTN_PRIMARY, FIELD, H1, LEAD, LINK, PAGE } from "@/app/components/ui";
import { questionsOf, updateSession, useSession } from "@/app/lib/session";

export default function Screen3() {
  const router = useRouter();
  const session = useSession();
  if (session === undefined) return <main className={`${PAGE} text-sm text-ink-2`}>読み込んでいます…</main>;
  if (!session || !session.analysis) {
    return (
      <main className={PAGE}>
        <section>
          <p>先に「2 読む」でフィードバックを読んでください。</p>
          <Link href="/reflection" className={`mt-2 inline-block ${LINK}`}>
            2 読む へ
          </Link>
        </section>
      </main>
    );
  }
  const t = session.transcript;
  const questions = questionsOf(session);
  const answers = questions.map((q) => session.answers.find((a) => a.question === q)?.answer ?? "");
  const setAnswer = (q: string, answer: string) =>
    updateSession((s) => ({ ...s, answers: [...s.answers.filter((a) => a.question !== q), { question: q, answer }], candidates: null }));
  const answered = answers.filter((a) => a.trim() !== "").length;

  return (
    <main className={PAGE}>
      <section>
        <h1 className={H1}>問いに答える</h1>
        <p className={LEAD}>場面を読んで受け取った問いに、自分の言葉で答えます。答えは、次に試す行動の候補を作る材料になります。全部に答えなくてもかまいません。AI の見立てと違うと思う所は、そのまま書いてください。</p>

        <ol className="mt-8 space-y-9">
          {questions.map((q, i) => (
            <li key={q}>
              <p className="text-[0.86rem] font-semibold text-accent">問 {i + 1}</p>
              <p className="mt-1 text-[1.08rem] font-semibold leading-[1.7]">{t ? <RefText t={t} text={q} /> : q}</p>
              <textarea value={answers[i]} onChange={(e) => setAnswer(q, e.target.value)} rows={3} placeholder="自分の言葉で" aria-label={`問 ${i + 1} への答え`} className={`mt-3 block w-full ${FIELD}`} />
            </li>
          ))}
        </ol>
        {questions.length === 0 && <p className="mt-6 text-ink-2">問いがありません（根拠のある場面が無いとされました）。</p>}

        <div className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => router.push("/spark")} className={BTN_PRIMARY}>
            次へ　次に試すひとつ
          </button>
          <span className="text-[0.86rem] tabular-nums text-ink-3">
            {answered}／{questions.length} に答えた
          </span>
        </div>
      </section>
    </main>
  );
}
