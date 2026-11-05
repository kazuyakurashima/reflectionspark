"use client";

// 発話の見せ方。画面 2 で根拠の発話番号を押したときに、その発話と前後 2 発話をその場で開く。
// 工程 0c の推測がある発話は、推測を先に、元の文字起こしを小さく添え、「分析には使っていない」と書く。
// 「抜け」（言葉が抜けていて推測できない所）は推測の文が無いので、抜けと見た所と手がかりだけを出す。
// 工程 0b で直した所がある発話は、元の文字起こしも添える。

import type { Transcript, Utterance } from "@/engine/types.mts";
import { around } from "@/app/lib/view";
import { isGap } from "@/app/lib/check-groups.mts";

export function guessesOf(t: Transcript, index: number) {
  return (t.step0c?.guesses ?? []).filter((g) => g.index === index);
}

export function correctionsOf(t: Transcript, index: number) {
  return t.step0b.applied.filter((c) => c.index === index);
}

export function UtteranceLine({ t, u, highlight = false }: { t: Transcript; u: Utterance; highlight?: boolean }) {
  const guesses = guessesOf(t, u.index);
  const corrections = correctionsOf(t, u.index);
  const corrected = corrections.length > 0 && u.text !== u.original;
  return (
    <div className={`rounded px-3 py-2 text-sm ${highlight ? "border-l-4 border-amber-500 bg-amber-50" : "border-l-4 border-transparent"}`}>
      <div className="flex gap-2">
        <span className="shrink-0 font-mono text-xs text-stone-500">{u.index}</span>
        <span className="shrink-0 font-semibold text-stone-700">{u.speaker}</span>
        <span className="whitespace-pre-wrap">{u.text ?? `（発話 ${u.index} の本文は出せません）`}</span>
      </div>
      {guesses.map((g, i) => (
        <div key={i} className="mt-1 ml-6 rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">
          {isGap(g) ? (
            <div>
              <span className="font-semibold">抜け</span>：「{g.fragment}」の所で言葉が抜けていると見た（{g.clue}）。推測は付けていません。
            </div>
          ) : (
            <div>
              <span className="font-semibold">推測</span>：「{g.fragment}」→「{g.guess}」（{g.clue}）
            </div>
          )}
          <div className="text-stone-500">元の文字起こし：{u.original}。{isGap(g) ? "この印" : "この推測"}は分析には使っていません。</div>
        </div>
      ))}
      {guesses.length === 0 && u.text !== u.original && (
        <div className="mt-1 ml-6 text-xs text-stone-500">
          元の文字起こし：{u.original}
          {corrected && `（直した所：${corrections.map((c) => `「${c.before}」→「${c.after}」`).join("、")}）`}
        </div>
      )}
    </div>
  );
}

/** 根拠の発話と前後 2 発話 */
export function UtteranceContext({ t, index }: { t: Transcript; index: number }) {
  return (
    <div className="mt-2 divide-y divide-stone-100 rounded border border-stone-200 bg-white">
      {around(t, index).map((u) => (
        <UtteranceLine key={u.index} t={t} u={u} highlight={u.index === index} />
      ))}
    </div>
  );
}
