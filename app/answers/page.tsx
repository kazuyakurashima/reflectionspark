"use client";

// 画面 3：問いに答える（文書での名前は「自分の言葉で」）。問いに本人が答えを書く。AI は呼ばない。答えは次の工程（行動の候補）に渡す。
// 問いの中の発言の番号は、載せるとその発言が出る（app/components/RefText.tsx）。
// 問いは並べて見せ、「回答する」を押した一つだけ書く欄を開く（欄が 3 つ並ぶと、問いの全体を見るのにスクロールが要るため）。書いた分はその場で保存する。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { RefText } from "@/app/components/RefText";
import { BTN_PRIMARY, BTN_SMALL, BTN_SMALL_PRIMARY, FIELD, H1, LEAD, LINK, PAGE } from "@/app/components/ui";
import { questionsOf, updateSession, useSession } from "@/app/lib/session";

export default function Screen3() {
  const router = useRouter();
  const session = useSession();
  /** いま書く欄を開いている問いの番号。開くのは一つだけ */
  const [open, setOpen] = useState<number | null>(null);
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
        <p className={LEAD}>場面を読んで受け取った問いに、自分の言葉で答えます。答えは、次に試す行動の候補を作る材料になります。全部に答えなくてもかまいません。AI の見立てと違うと思う所は、そのまま書いてかまいません。</p>

        <ol className="mt-7 border-t border-line">
          {questions.map((q, i) => {
            const answer = answers[i].trim();
            const isOpen = open === i;
            return (
              <li key={q} className="border-b border-line py-5">
                <p className="text-[0.86rem] font-semibold text-accent">問 {i + 1}</p>
                <p className="mt-1 text-[1.04rem] font-semibold leading-[1.7]">{t ? <RefText t={t} text={q} /> : q}</p>
                {isOpen ? (
                  <>
                    <textarea autoFocus value={answers[i]} onChange={(e) => setAnswer(q, e.target.value)} rows={4} placeholder="自分の言葉で" aria-label={`問 ${i + 1} への回答`} className={`mt-3 block w-full ${FIELD}`} />
                    <button type="button" onClick={() => setOpen(null)} className={`mt-2.5 ${answer === "" ? BTN_SMALL : BTN_SMALL_PRIMARY}`}>
                      {answer === "" ? "閉じる" : "この回答にする"}
                    </button>
                  </>
                ) : (
                  <>
                    {answer !== "" && <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[0.95rem] leading-[1.7] text-ink-2">{answer}</p>}
                    <button type="button" onClick={() => setOpen(i)} className={`mt-2.5 ${BTN_SMALL}`}>
                      {answer === "" ? "回答する" : "回答を直す"}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ol>
        {questions.length === 0 && <p className="mt-6 text-ink-2">問いがありません（根拠のある場面が無いとされました）。</p>}

        <div className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => router.push("/spark")} className={BTN_PRIMARY}>
            次へ　次に試すひとつ
          </button>
          <span className="text-[0.86rem] tabular-nums text-ink-3">
            {answered}／{questions.length} に回答した
          </span>
        </div>
      </section>
    </main>
  );
}
