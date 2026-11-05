"use client";

// 画面 2：フィードバックを読む。先に自分の点と一言を付ける（AI に渡さない）。そのあと、
// ひと目で → サマリー → 面談の流れ → よく表れた所 → 次に試せる所 → 問い → 項目ごとの点と合計 → 気づきの持ち主 → 数えた記録 → 倫理チェック
// の順に置く（docs/設計書.md「画面 2 の出力の形と見せ方」）。要点だけを先に見せ、詳しい所は押すと開く。
// 場面は、確かめられること（原文の 3 行、観察、直後の相手の反応）を先に、AI の読みを後に置く。AI の読みは最初は閉じ、開くのに入力は求めない。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { AnalyzeResponse } from "@/engine/server.mts";
import type { Scene, Transcript } from "@/engine/types.mts";
import { RUBRIC_ITEMS } from "@/engine/rubric.mts";
import { utteranceListLabel, utteranceRangeLabel, utterancesAround } from "@/engine/utterance-no.mts";
import { Collapsible } from "@/app/components/Collapsible";
import { ScoreTable } from "@/app/components/Scores";
import { UtteranceLine } from "@/app/components/UtteranceView";
import { updateSession, useSession } from "@/app/lib/session";
import { countTranscript, ethicsMark } from "@/app/lib/view";

export default function Screen2() {
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<string>("");
  const [note, setNote] = useState("");
  const started = useRef(false);
  const transcript = session?.transcript ?? null;
  const analysis = session?.analysis ?? null;
  const firstMeeting = session?.firstMeeting ?? true;

  useEffect(() => {
    // 分析は自己採点と並行して始める。自己採点はこの呼び出しに入れない（決まり 10）
    if (!transcript || analysis || started.current) return;
    started.current = true;
    (async () => {
      try {
        const r = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript, firstMeeting }),
        });
        const d = (await r.json()) as AnalyzeResponse & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `分析に失敗しました（${r.status}）`);
        updateSession((s) => ({ ...s, analysis: { step1: d.step1, step2: d.step2, mock: d.mock } }));
      } catch (e) {
        setError((e as Error).message);
        started.current = false;
      }
    })();
  }, [transcript, analysis, firstMeeting]);

  if (session === undefined) return <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-stone-600">読み込んでいます…</main>;
  if (!session || !transcript) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <p className="text-sm">先に画面 1 で文字起こしを整形してください。</p>
        <Link href="/" className="text-sm text-sky-800 underline">
          画面 1 へ
        </Link>
      </main>
    );
  }
  const t = transcript;
  const selfDone = session.selfScore !== null;

  const submitSelf = () => {
    const n = Number(score);
    if (!Number.isInteger(n) || n < 1 || n > 10) return;
    updateSession((s) => ({ ...s, selfScore: n, selfNote: note }));
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold">2. フィードバックを読む</h1>
      <p className="mt-1 text-sm text-stone-600">
        {session.otherName ? `${session.otherName}との` : ""}
        {t.kind === "コーチング" ? "1on1" : `${t.kind}面談`}。{t.utterances.length} 発話。{firstMeeting ? "初回の面談として読みます。" : "続きの面談として読みます（前回決めたことに触れたかも見ます）。"}
      </p>

      <section className="mt-5 rounded border border-stone-200 bg-white p-4">
        <h2 className="font-bold">0. 自分の点と一言</h2>
        <p className="mt-1 text-sm text-stone-600">読む前に付けます。この点と一言は AI に渡しません。あとで AI の点と並べます。</p>
        {selfDone ? (
          <p className="mt-2 text-sm">
            自分の点：<span className="font-semibold">{session.selfScore}／10</span>
            {session.selfNote && <span className="ml-2 text-stone-700">「{session.selfNote}」</span>}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-stone-600">この面談の点（10 点満点、合計一つ）</span>
              <input type="number" min={1} max={10} value={score} onChange={(e) => setScore(e.target.value)} className="mt-1 w-24 rounded border border-stone-300 px-2 py-1" />
            </label>
            <label className="grow text-sm">
              <span className="block text-stone-600">一言</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：話しすぎた" className="mt-1 w-full rounded border border-stone-300 px-2 py-1" />
            </label>
            <button type="button" onClick={submitSelf} disabled={!(Number(score) >= 1 && Number(score) <= 10)} className="rounded bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-40">
              付けた。読む
            </button>
          </div>
        )}
      </section>

      {!selfDone ? (
        <p className="mt-4 text-sm text-stone-500">自分の点を付けると、AI のフィードバックが開きます。{analysis ? "（分析は届いています）" : "（分析しています…）"}</p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-700">{error}</p>
      ) : !analysis ? (
        <p className="mt-4 text-sm text-stone-500">分析しています…</p>
      ) : (
        <Feedback t={t} a={analysis} selfScore={session.selfScore} sparkSentence={session.spark?.sentence ?? null} />
      )}
    </main>
  );
}

function Feedback({
  t,
  a,
  selfScore,
  sparkSentence,
}: {
  t: Transcript;
  a: { step1: AnalyzeResponse["step1"]; step2: AnalyzeResponse["step2"]; mock: boolean };
  selfScore: number | null;
  sparkSentence: string | null;
}) {
  const { step1, step2 } = a;
  const good = step1.scenes.find((s) => s.type === "よく表れた所");
  const next = step1.scenes.find((s) => s.type === "次に試せる所");
  const counts = countTranscript(t);
  const flow = step1.flow;
  return (
    <div className="mt-6 space-y-6">
      {a.mock && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          API キーが無いので、仮の出力です。引用は本文の発話ですが、読みと問いと点は仮の文です。
        </p>
      )}

      <section>
        <h2 className="font-bold">1. ひと目で</h2>
        {step1.noScene ? (
          <p className="mt-1 text-sm">根拠のある場面が無いとされました：{step1.noScene}</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {good && (
              <li>
                <a href="#good" className="text-sky-800 hover:underline">
                  よく表れた所：{good.context}
                </a>
              </li>
            )}
            {next && (
              <li>
                <a href="#next" className="text-sky-800 hover:underline">
                  次に試せる所：{next.context}
                </a>
              </li>
            )}
            {sparkSentence && (
              <li className="font-semibold">
                次に試すひとつ：
                <Link href="/spark" className="text-sky-800 hover:underline">
                  {sparkSentence}
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-bold">2. サマリー</h2>
        <p className="mt-1 text-sm">{step1.summary || "（無し）"}</p>
      </section>

      <section>
        <h2 className="font-bold">3. 面談の流れ</h2>
        {flow.length > 0 && (
          <>
            <p className="mt-1 text-sm">{flow[0]}</p>
            {flow.length > 1 && (
              <Collapsible label="残りを開く" className="mt-1">
                <ol className="list-decimal space-y-1 pl-5 text-sm" start={2}>
                  {flow.slice(1).map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ol>
              </Collapsible>
            )}
          </>
        )}
      </section>

      {(good || next) && (
        <p className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          場面の読み方：上から「原文のやりとり」（文字起こしのまま）、「文字起こしから確かめられること」（AI が書いた、事実の説明）、「AI の読み」（解釈。最初は閉じています）、「問い」（あなたが考える所）の順に並べています。「引用は原文と一致」は、引用が文字起こしのとおりであることの印で、AI の読みが合っていることの印ではありません。
        </p>
      )}

      {good && <SceneCard id="good" n={4} scene={good} t={t} />}
      {next && <SceneCard id="next" n={5} scene={next} t={t} />}

      <section>
        <h2 className="font-bold">6. 問い</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {step1.scenes.map((s, i) => (
            <li key={i}>{s.question}</li>
          ))}
          {step1.extraQuestion && <li>{step1.extraQuestion}</li>}
        </ul>
        <p className="mt-1 text-xs text-stone-500">答えは次の画面（3. 自分の言葉で）で書きます。</p>
      </section>

      <hr className="border-t-4 border-stone-300" />

      <section>
        <h2 className="font-bold">7. 項目ごとの点と合計</h2>
        <ScoreTable items={step2.items} total={step2.total} t={t} selfScore={selfScore} />
      </section>

      <section>
        <h2 className="font-bold">8. 気づきの持ち主</h2>
        <p className="mt-1 text-sm">面談の最後に残ったテーマを主に言葉にしたのは：{step2.insightOwner}</p>
      </section>

      <section>
        <h2 className="font-bold">9. 数えた記録</h2>
        <Collapsible label="数字を開く（点には入りません）" className="mt-1">
          <ul className="list-disc pl-5 text-sm">
            <li>
              話した量（文字数）：本人 {Math.round(counts.selfRatio * 100)}%、相手 {100 - Math.round(counts.selfRatio * 100)}%（{counts.selfChars} 字／{counts.otherChars} 字）
            </li>
            {counts.longestRun && (
              <li>
                いちばん長く続けて話した：{counts.longestRun.speaker}、{counts.longestRun.chars} 字（{utteranceRangeLabel(counts.longestRun.from, counts.longestRun.to)}）
              </li>
            )}
          </ul>
        </Collapsible>
      </section>

      <section>
        <h2 className="font-bold">10. 倫理チェック</h2>
        <p className="mt-1 text-sm">
          <span className="font-mono">{ethicsMark(step2.ethics.level)}</span> {step2.ethics.level === "所属の手順" ? step2.ethics.text : `${step2.ethics.level}`}
          {step2.ethics.level !== "問題なし" && step2.ethics.level !== "所属の手順" && (
            <Collapsible label="理由を開く" className="mt-1">
              <p className="text-sm">
                {step2.ethics.text}
                {step2.ethics.viewpoint && `（観点：${step2.ethics.viewpoint}）`}
                {step2.ethics.utterances.length > 0 && `（${utteranceListLabel(step2.ethics.utterances)}）`}
              </p>
            </Collapsible>
          )}
        </p>
        <p className="mt-1 text-xs text-stone-500">点にはせず、合計にも入れません。</p>
      </section>

      <div className="flex items-center gap-3">
        <Link href="/answers" className="rounded bg-sky-800 px-4 py-2 text-sm text-white">
          次へ：3. 自分の言葉で →
        </Link>
        <span className="text-xs text-stone-500">問いに自分の答えを書きます。</span>
      </div>
    </div>
  );
}

function SceneCard({ id, n, scene, t }: { id: string; n: number; scene: Scene; t: Transcript }) {
  const [wide, setWide] = useState(false);
  const quote = scene.quotes[0];
  // 引用した発話と、直前・直後の発話。アプリが発話番号から取る（AI には書かせない。決まり 1）
  const lines = quote ? utterancesAround(t.utterances, quote.index, quote.endIndex, wide ? 3 : 1) : [];
  const quoted = (i: number) => quote !== undefined && i >= quote.index && i < Math.max(quote.endIndex, quote.index + 1);
  const tagOf = (i: number) => {
    if (!quote) return undefined;
    if (quoted(i)) return "引用";
    if (i === quote.index - 1) return "直前";
    if (i === Math.max(quote.endIndex, quote.index + 1)) return "直後";
    return undefined;
  };
  return (
    <section id={id} className="rounded border border-stone-200 bg-white p-4">
      <h2 className="font-bold">
        {n}. {scene.type}
      </h2>
      <p className="mt-1 text-sm">{scene.context}</p>
      {scene.items.length > 0 && (
        <p className="mt-1 text-xs text-stone-500">関わる項目：{scene.items.map((i) => `${i} ${RUBRIC_ITEMS.find((r) => r.n === i)?.name ?? ""}`).join("、")}</p>
      )}

      <div className="mt-3">
        <h3 className="text-xs font-semibold text-stone-500">原文のやりとり（直前・引用した発話・直後）</h3>
        {quote ? (
          <>
            <div className="mt-1 divide-y divide-stone-100 rounded border border-stone-200">
              {lines.map((u) => (
                <UtteranceLine key={u.index} t={t} u={u} highlight={quoted(u.index)} tag={tagOf(u.index) ?? "　"} />
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-500">
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">引用は原文と一致</span>
              <span className="ml-2">「引用」の行（{utteranceRangeLabel(quote.index, Math.max(quote.endIndex, quote.index + 1) - 1)}）が、AI が引用した発話です。</span>
              <button type="button" onClick={() => setWide((w) => !w)} aria-expanded={wide} className="ml-2 text-sky-800 underline-offset-2 hover:underline">
                {wide ? "直前・直後だけに戻す" : "前後をもう少し読む"}
              </button>
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-stone-600">この場面には、原文と一致した引用がありません。</p>
        )}
      </div>

      <div className="mt-4 text-sm">
        <h3 className="text-xs font-semibold text-stone-500">文字起こしから確かめられること（AI が書いた、事実の説明）</h3>
        <dl className="mt-1 space-y-1 border-l-2 border-stone-400 pl-3">
          <dt className="font-semibold">観察</dt>
          <dd>{scene.observation || "（書かれていません）"}</dd>
          <dt className="font-semibold">直後の相手の反応</dt>
          <dd>{scene.reaction || "（書かれていません）"}</dd>
        </dl>
      </div>

      <div className="mt-4 text-sm">
        <h3 className="text-xs font-semibold text-stone-500">AI の読み（解釈）</h3>
        <p className="mt-1 text-xs text-stone-500">開く前に、自分ならこの場面をどう読むかを考えてみてください。何も書かなくても開けます。AI の読みと自分の考えが違っていてかまいません。</p>
        <Collapsible label="AI の読みを開く" openLabel="AI の読みを閉じる" className="mt-1">
          <div className="space-y-2 border-l-2 border-dashed border-stone-400 pl-3">
            <p>{scene.reading || "（書かれていません）"}</p>
            {scene.asChoice && (
              <div>
                <p className="font-semibold">意図した選択として見ると</p>
                <p>{scene.asChoice}</p>
              </div>
            )}
          </div>
        </Collapsible>
      </div>

      <p className="mt-4 rounded bg-stone-50 px-3 py-2 text-sm">
        <span className="font-semibold">問い</span>　{scene.question}
      </p>
    </section>
  );
}
