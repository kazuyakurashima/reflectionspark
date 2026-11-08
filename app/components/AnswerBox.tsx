"use client";

// 問いへの答え（画面 2 の中で書く）。書く欄は「回答する」を押したときだけ開く（読むと書くを、本人が切り替えられるように）。
// 書いた分はその場で保存する。答えが変わったら、次に試す行動の候補を作り直す（candidates を消す）。答えは問いの文で保存する。
// 答えは工程 3（行動の候補）に渡す。答えなくても先へ進める。

import { useState } from "react";

import { updateSession, useSession } from "@/app/lib/session";
import { BTN_SECONDARY, BTN_SMALL, BTN_SMALL_PRIMARY, FIELD } from "./ui";

export function AnswerBox({ q, label, note }: { q: string; label: string; note: string }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const value = session?.answers.find((a) => a.question === q)?.answer ?? "";
  const answer = value.trim();
  const setAnswer = (v: string) =>
    updateSession((s) => ({ ...s, answers: [...s.answers.filter((a) => a.question !== q), { question: q, answer: v }], candidates: null }));

  if (open) {
    return (
      <div className="mt-4">
        <p className="text-[0.86rem] leading-[1.7] text-ink-2">{note}</p>
        <textarea autoFocus value={value} onChange={(e) => setAnswer(e.target.value)} rows={4} placeholder="自分の言葉で" aria-label={label} className={`mt-2 block w-full ${FIELD}`} />
        <button type="button" onClick={() => setOpen(false)} className={`mt-2.5 ${answer === "" ? BTN_SMALL : BTN_SMALL_PRIMARY}`}>
          {answer === "" ? "閉じる" : "この回答にする"}
        </button>
      </div>
    );
  }
  if (answer !== "") {
    return (
      <div className="mt-4 border-l-2 border-accent pl-4">
        <p className="text-[0.8rem] font-semibold text-ink-2">自分の答え</p>
        <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[0.95rem] leading-[1.75]">{answer}</p>
        <button type="button" onClick={() => setOpen(true)} className={`mt-2 ${BTN_SMALL}`}>
          回答を直す
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className={`mt-4 ${BTN_SECONDARY}`}>
      回答する
    </button>
  );
}
