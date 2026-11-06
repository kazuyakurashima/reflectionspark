"use client";

// 画面 2：読む（フィードバックを読む）。比較案 D2 Simple を土台にした形。
// 最初に見えるのは、面談の地図 → 場面を一つ（やりとり → 自分の見立て → AI の見立て → 問い）→ 下に固定した「次にすること」一つ。
// 場面の中は、確かめられるもの（原文のやりとり）を先に、解釈（AI の見立て）を後に置く（原則 2）。AI の見立ては本人が開く。書き込みは求めない。
// 項目ごとの点と合計は、引用と問いの後に置き、本人が自分の点を一つ付けてから並べる（原則 1・決まり 8）。自分の点・一言・見立ては AI に渡さない（決まり 10）。
// 場面の種別（よく表れた所／次に試せる所）は、AI の見立てを開くまで出さない。倫理チェックはいつも最後の 1 行で、点にしない。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { AnalyzeResponse } from "@/engine/server.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { Scene, Transcript } from "@/engine/types.mts";
import { RUBRIC_ITEMS } from "@/engine/rubric.mts";
import { findUtteranceRefs, utteranceListLabel, utteranceRangeLabel } from "@/engine/utterance-no.mts";
import { Atlas } from "@/app/components/Atlas";
import { SceneLines } from "@/app/components/SceneLines";
import { ScoreTable } from "@/app/components/Scores";
import { Island } from "@/app/components/UtteranceView";
import { WaitNote } from "@/app/components/WaitNote";
import { chaptersOf, sceneSpan, spanWindow, wideWindow } from "@/app/lib/scene-view.mts";
import type { SceneSpan } from "@/app/lib/scene-view.mts";
import { updateSession, useSession } from "@/app/lib/session";
import type { SessionData } from "@/app/lib/session";
import { countTranscript, ethicsMark } from "@/app/lib/view";

const PAGE = "mx-auto max-w-3xl px-4 text-base leading-[1.85] md:text-[1.0625rem]";
const PRIMARY = "inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-accent px-6 py-2.5 font-semibold text-white hover:bg-accent/90";

export default function Screen2() {
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const [retry, setRetry] = useState(0);
  const transcript = session?.transcript ?? null;
  const analysis = session?.analysis ?? null;
  const firstMeeting = session?.firstMeeting ?? true;

  useEffect(() => {
    // 自己採点・一言・見立てはこの呼び出しに入れない（決まり 10）
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
  }, [transcript, analysis, firstMeeting, retry]);

  if (session === undefined) return <main className={`${PAGE} py-8 text-sm text-ink-2`}>読み込んでいます…</main>;
  if (!session || !transcript) {
    return (
      <main className={`${PAGE} py-8`}>
        <p>先に画面 1 で文字起こしを整形してください。</p>
        <Link href="/" className="text-accent underline underline-offset-[3px]">
          画面 1 へ
        </Link>
      </main>
    );
  }
  const t = transcript;
  const counts = countTranscript(t);
  const { self, other } = SPEAKER_LABELS[t.kind];
  const selfPct = Math.round(counts.selfRatio * 100);

  return (
    <main className={PAGE}>
      <section className="pb-6 pt-10">
        <h1 className="text-[1.75rem] font-semibold leading-snug">
          {session.otherName ? `${session.otherName}との` : ""}
          {t.kind === "コーチング" ? "1on1" : `${t.kind}面談`}
        </h1>
        <p className="mt-1 text-[0.95rem] text-ink-2">
          {t.utterances.length} 発話。話した量は{self} {selfPct}%、{other} {100 - selfPct}%。{firstMeeting ? "初回の面談として読みます。" : "続きの面談として読みます（前回決めたことに触れたかも見ます）。"}
        </p>
      </section>

      {error ? (
        <div className="rounded-md border border-red-200 bg-surface px-4 py-3 text-[0.95rem]">
          <p className="text-red-700">分析できませんでした：{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setRetry((n) => n + 1);
            }}
            className="mt-2 rounded-full border border-line-2 px-4 py-1"
          >
            もう一度分析する
          </button>
        </div>
      ) : !analysis ? (
        <section className="border-t border-line py-8">
          <p className="font-semibold">AI が面談を読んでいます…</p>
          <WaitNote time="1 分ほど" reopen="この画面を開き直すと、もう一度最初から分析します。" />
          <div className="mt-6 rounded-md border border-line bg-surface px-5 py-4">
            <SelfScore selfScore={session.selfScore} lead="待つ間に、この面談の自分の点を付けておけます（付けなくても読めます）。" />
          </div>
        </section>
      ) : (
        <Feedback t={t} a={analysis} session={session} />
      )}
    </main>
  );
}

/** 自分の点（10 点満点、一つ）。AI に渡さない（決まり 10） */
function SelfScore({ selfScore, lead }: { selfScore: number | null; lead: string }) {
  return (
    <div>
      <p className="text-[0.95rem]">{lead}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="この面談の自分の点（10 点満点）">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => updateSession((s) => ({ ...s, selfScore: v }))}
            aria-pressed={selfScore === v}
            className={`h-11 w-9 rounded border text-[0.95rem] tabular-nums ${selfScore === v ? "border-ink bg-ink text-paper" : "border-line-2 bg-paper text-ink-2 hover:border-ink-2"}`}
          >
            {v}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-3">10 点満点で一つ。この点は AI に渡しません。あとで AI の点と並べます。</p>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 border-b-[1.5px] border-r-[1.5px] border-ink-2 transition-transform ${open ? "rotate-45" : "-rotate-45"}`} />;
}

/** 必要なときに開く引き出し */
function Drawer({ id, title, sub, open, onToggle, children }: { id?: string; title: string; sub: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4 border-b border-line">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-[3.25rem] w-full items-center gap-3 py-3 text-left">
        <Chevron open={open} />
        <span className="font-semibold">{title}</span>
        <span className="ml-auto text-right text-[0.82rem] text-ink-3">{sub}</span>
      </button>
      {open && <div className="pb-6">{children}</div>}
    </div>
  );
}

/** 場面の中の手順一つ。番号は、読む順（やりとり → 自分の見立て → AI の見立て → 問い） */
function Step({ n, title, note, last = false, children }: { n: number; title: string; note?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative sm:pl-11 ${last ? "" : "pb-9"}`}>
      {!last && <span aria-hidden="true" className="absolute bottom-1 left-[0.84rem] top-9 hidden w-px bg-line-2 sm:block" />}
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-[0.95rem] font-semibold">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full border border-line-2 bg-surface text-xs tabular-nums text-ink-2 sm:absolute sm:left-0 sm:top-0">{n}</span>
        {title}
        {note && <span className="text-[0.82rem] font-normal text-ink-3">{note}</span>}
      </h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Feedback({ t, a, session }: { t: Transcript; a: { step1: AnalyzeResponse["step1"]; step2: AnalyzeResponse["step2"]; mock: boolean }; session: SessionData }) {
  const { step1, step2 } = a;
  const scenes = step1.scenes;
  const n = t.utterances.length;
  const spans: (SceneSpan | null)[] = scenes.map((s) => sceneSpan(s.quotes, n));
  const chapters = chaptersOf(step1.flow, n);
  const counts = countTranscript(t);
  const { self, other } = SPEAKER_LABELS[t.kind];
  const selfPct = Math.round(counts.selfRatio * 100);

  const [current, setCurrent] = useState(0);
  const [seen, setSeen] = useState<number[]>([0]);
  const [wide, setWide] = useState(false);
  const [aiOpen, setAiOpen] = useState<number[]>([]);
  const [open, setOpen] = useState<{ detail: boolean; scores: boolean; all: boolean }>({ detail: false, scores: false, all: false });
  const [flash, setFlash] = useState<number | null>(null);
  const [ethicsOpen, setEthicsOpen] = useState(false);
  const sceneRef = useRef<HTMLElement>(null);

  const scene: Scene | undefined = scenes[current];
  const span = spans[current] ?? null;
  const nextScene = scenes.findIndex((_, k) => !seen.includes(k));

  const showScene = (k: number, scroll: boolean) => {
    setCurrent(k);
    setWide(false);
    setSeen((s) => (s.includes(k) ? s : [...s, k]));
    if (scroll) requestAnimationFrame(() => sceneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  /** 地図の棒や根拠の番号から、全発話の中のその発話へ移る */
  const openUtterance = (i: number) => {
    setOpen((o) => ({ ...o, all: true }));
    setFlash(i);
  };
  useEffect(() => {
    if (flash === null) return;
    document.getElementById(`u-${flash}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [flash]);

  const own = session.ownViews[current] ?? "";
  const setOwn = (v: string) =>
    updateSession((s) => {
      const next = [...s.ownViews];
      next[current] = v;
      return { ...s, ownViews: next.map((x) => x ?? "") };
    });

  // 広げたときは、AI が場面の文の中で番号で触れた近くの発話まで並べる（文で触れた発話を原文で確かめられるように）
  const sceneRefs = scene ? [scene.observation, scene.reaction, scene.reading, scene.asChoice ?? "", scene.question].flatMap((x) => findUtteranceRefs(x)) : [];
  const win = span ? (wide ? wideWindow(span, sceneRefs, n) : spanWindow(span, n, 1)) : null;
  const discarded = scene?.discardedQuotes.length ?? 0;
  const verified = scene?.quotes.length ?? 0;
  const sceneFocal = new Map<number, number>();
  const quotedAll = new Set<number>();
  spans.forEach((s, k) => {
    if (!s) return;
    sceneFocal.set(s.focal, k);
    s.quoted.forEach((i) => quotedAll.add(i));
  });

  return (
    <>
      {a.mock && <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">API キーが無いので、仮の出力です。引用は本文の発話ですが、読みと問いと点は仮の文です。</p>}

      {step1.noScene ? (
        <section className="border-t border-line py-8">
          <p>根拠のある場面が無いとされました：{step1.noScene}</p>
        </section>
      ) : (
        <>
          <p className="pb-8 text-[1.02rem]">
            AI がこの面談から、{scenes.length} つの場面を選びました。場面ごとに、やりとりを読んで、問いを一つ受け取ります。
            {session.spark && (
              <span className="mt-2 block text-[0.95rem] text-ink-2">
                次に試すひとつ：
                <Link href="/spark" className="font-semibold text-ink underline decoration-amber-500 underline-offset-4">
                  {session.spark.sentence}
                </Link>
              </span>
            )}
          </p>

          <section className="border-t border-line pb-9 pt-6" aria-label="面談の地図">
            <Atlas t={t} spans={spans} current={current} chapters={chapters} onScene={(k) => showScene(k, true)} onUtterance={openUtterance} />
          </section>

          <section ref={sceneRef} className="scroll-mt-4 border-t border-line pt-7" aria-label={`場面 ${current + 1}`}>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="場面を選ぶ">
              {scenes.map((_, k) => {
                const s = spans[k];
                const w = s ? spanWindow(s, n, 1) : null;
                const active = k === current;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => showScene(k, false)}
                    aria-pressed={active}
                    className={`rounded-lg border px-4 py-2.5 text-left transition-colors ${active ? "border-ink bg-ink text-paper" : "border-line-2 bg-surface text-ink-2 hover:border-ink-2"}`}
                  >
                    <span className="block font-semibold leading-snug">場面 {k + 1}</span>
                    <span className="block text-xs leading-snug opacity-80">
                      {w ? utteranceRangeLabel(w.from, w.to) : "引用なし"}
                      {!active && seen.includes(k) ? "　読んだ" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            {scene && (
              <>
                <p className="mb-8 mt-6 text-[1.08rem] leading-[1.8]">{scene.context}</p>

                <Step n={1} title="やりとりを読む">
                  {span && win ? (
                    <div className="rounded-md border border-line bg-surface shadow-[0_8px_24px_-16px_rgba(29,27,24,0.25)]">
                      <SceneLines t={t} span={span} from={win.from} to={win.to} />
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[0.82rem] text-ink-2 sm:px-5">
                        <span>
                          <span aria-hidden="true" className="mr-1.5 font-bold text-accent">
                            ✓
                          </span>
                          {discarded === 0 ? `引用 ${verified} 件すべて原文と一致` : `引用 ${verified}／${verified + discarded} 件が原文と一致（一致しない引用は出していません）`}
                        </span>
                        <button type="button" onClick={() => setWide((w) => !w)} aria-expanded={wide} className="min-h-9 text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent">
                          {wide ? "最初の範囲に戻す" : "前後をもう少し読む"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-ink-2">この場面には、原文と一致した引用がありません。</p>
                  )}
                </Step>

                <Step n={2} title="自分ならどう読むか" note="書かなくても進めます">
                  <input
                    type="text"
                    value={own}
                    onChange={(e) => setOwn(e.target.value)}
                    autoComplete="off"
                    placeholder="ここで何が起きていたと思いますか"
                    aria-label={`場面 ${current + 1} の自分の見立て`}
                    className="block w-full border-0 border-b border-line-2 bg-transparent py-2 placeholder:text-ink-3 focus:border-accent focus:outline-none"
                  />
                  <p className="mt-1.5 text-xs text-ink-3">書いた言葉は AI に渡しません。AI の見立てを開くと、上下に並びます。</p>
                </Step>

                <Step n={3} title="AI の見立てと比べる" note="開かなくても進めます">
                  <AiView scene={scene} own={own.trim()} open={aiOpen.includes(current)} onToggle={() => setAiOpen((o) => (o.includes(current) ? o.filter((k) => k !== current) : [...o, current]))} />
                </Step>

                <Step n={4} title="この場面の問いを受け取る" last>
                  <p className="text-[1.38rem] font-medium leading-[1.65] text-pretty">{scene.question}</p>
                  <p className="mt-3 text-[0.86rem] text-ink-2">答えは次の画面「3. 自分の言葉で」で書きます。AI の見立てと違うと思う所は、そのまま書いてかまいません。</p>
                </Step>
              </>
            )}
          </section>
        </>
      )}

      <section className="mt-12 border-t border-line pt-7" aria-label="面談の全体">
        <h2 className="text-[0.95rem] font-semibold">面談の全体</h2>
        <p className="mb-3 text-[0.86rem] text-ink-2">必要なときに開きます。開かなくても、次へ進めます。</p>
        <div className="border-t border-line">
          <Drawer title="まとめと流れ" sub="サマリー・面談の流れ・数えた記録" open={open.detail} onToggle={() => setOpen((o) => ({ ...o, detail: !o.detail }))}>
            <dl className="space-y-5 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-ink-3">
              <div>
                <dt>サマリー</dt>
                <dd>{step1.summary || "（無し）"}</dd>
              </div>
              {step1.flow.length > 0 && (
                <div>
                  <dt>面談の流れ</dt>
                  <dd>
                    <ol className="list-decimal pl-6">
                      {step1.flow.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ol>
                  </dd>
                </div>
              )}
              <div>
                <dt>気づきの持ち主</dt>
                <dd>面談の最後に残ったテーマを主に言葉にしたのは：{step2.insightOwner}</dd>
              </div>
              <div>
                <dt>数えた記録（点には入りません）</dt>
                <dd>
                  話した量（文字数）：{self} {selfPct}%、{other} {100 - selfPct}%（{counts.selfChars} 字／{counts.otherChars} 字）。
                  {counts.longestRun && `いちばん長く続けて話した：${counts.longestRun.speaker}、${counts.longestRun.chars} 字（${utteranceRangeLabel(counts.longestRun.from, counts.longestRun.to)}）。`}
                </dd>
              </div>
              {step1.extraQuestion && (
                <div>
                  <dt>もう一つの問い</dt>
                  <dd>{step1.extraQuestion}</dd>
                </div>
              )}
            </dl>
          </Drawer>

          <Drawer
            title="項目ごとの点と合計"
            sub={session.selfScore === null ? "先に自分の点を一つ" : "AI の点と自分の点"}
            open={open.scores}
            onToggle={() => setOpen((o) => ({ ...o, scores: !o.scores }))}
          >
            {session.selfScore === null ? (
              <div className="rounded-md border border-line bg-surface px-5 py-4">
                <SelfScore selfScore={null} lead="先に、この面談の自分の点を一つ付けます。付けると、AI の点が並びます。" />
              </div>
            ) : (
              <>
                <ScoreTable items={step2.items} total={step2.total} t={t} selfScore={session.selfScore} />
                <label className="mt-5 block text-[0.86rem] text-ink-2">
                  自分の点への一言（書かなくてもかまいません。AI に渡しません）
                  <input
                    type="text"
                    value={session.selfNote}
                    onChange={(e) => updateSession((s) => ({ ...s, selfNote: e.target.value }))}
                    autoComplete="off"
                    placeholder="例：話しすぎた"
                    className="mt-1 block w-full border-0 border-b border-line-2 bg-transparent py-1.5 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
                  />
                </label>
              </>
            )}
          </Drawer>

          <Drawer id="all-utterances" title="全発話" sub={`${n} 発話`} open={open.all} onToggle={() => setOpen((o) => ({ ...o, all: !o.all }))}>
            <ol className="space-y-3">
              {t.utterances.map((u) => {
                const k = sceneFocal.get(u.index);
                return (
                  <li key={u.index} id={`u-${u.index}`} className={`scroll-mt-4 rounded-2xl transition-shadow duration-500 ${flash === u.index ? "shadow-[0_0_0_3px_var(--color-accent-mid)]" : ""}`}>
                    <Island t={t} u={u} compact role={k !== undefined ? "focal" : "plain"} tag={k !== undefined ? `場面 ${k + 1} で引用` : quotedAll.has(u.index) ? "引用" : undefined} />
                  </li>
                );
              })}
            </ol>
          </Drawer>
        </div>

        <p className="mt-6 text-[0.86rem] text-ink-2">
          <span className="mr-1.5 font-semibold text-ink">{ethicsMark(step2.ethics.level)} 倫理チェック</span>
          {step2.ethics.level === "所属の手順" ? step2.ethics.text : `${step2.ethics.level}。`}点にはせず、合計にも入れません。
          {step2.ethics.level !== "問題なし" && step2.ethics.level !== "所属の手順" && (
            <>
              <button type="button" onClick={() => setEthicsOpen((o) => !o)} aria-expanded={ethicsOpen} className="ml-2 text-accent underline decoration-accent/40 underline-offset-[3px]">
                {ethicsOpen ? "理由を閉じる" : "理由を開く"}
              </button>
              {ethicsOpen && (
                <span className="mt-1 block">
                  {step2.ethics.text}
                  {step2.ethics.viewpoint && `（観点：${step2.ethics.viewpoint}）`}
                  {step2.ethics.utterances.length > 0 && `（${utteranceListLabel(step2.ethics.utterances)}）`}
                </span>
              )}
            </>
          )}
        </p>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 mt-10 border-t border-line bg-paper/90 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {nextScene >= 0 ? (
            <button type="button" onClick={() => showScene(nextScene, true)} className={PRIMARY}>
              場面 {nextScene + 1} を読む
            </button>
          ) : (
            <Link href="/answers" className={PRIMARY}>
              次へ　3. 自分の言葉で
            </Link>
          )}
          <span className="hidden text-[0.86rem] text-ink-2 sm:inline">
            {step1.noScene ? "問いに、自分の言葉で答えます。" : nextScene >= 0 ? `今は場面 ${current + 1}／${scenes.length}。問いは場面ごとに一つあります。` : `${scenes.length} つの場面を読みました。問いに、自分の言葉で答えます。`}
          </span>
          {nextScene >= 0 && (
            <Link href="/answers" className="ml-auto text-[0.82rem] text-ink-3 underline underline-offset-[3px] hover:text-ink">
              読まずに 3 へ進む
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

/** AI の見立て。最初は閉じていて、本人が開く。開くのに入力は求めない */
function AiView({ scene, own, open, onToggle }: { scene: Scene; own: string; open: boolean; onToggle: () => void }) {
  const items = scene.items.map((i) => `${i} ${RUBRIC_ITEMS.find((r) => r.n === i)?.name ?? ""}`).join("、");
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 items-center gap-3 rounded-full border border-line-2 bg-surface px-5 py-1.5 font-semibold hover:border-ink-2">
        <Chevron open={open} />
        {open ? "AI の見立てを閉じる" : "AI の見立てを開く"}
      </button>
      {open && (
        <div className="mt-5">
          <p className="text-[0.9rem] text-ink-2">
            AI はこの場面を<b className="font-semibold text-ink">「{scene.type}」</b>として選びました。{items && `関わる項目：${items}。`}
          </p>
          <div className="mt-4 space-y-5">
            {own && (
              <div className="border-l-2 border-ink-2 pl-4">
                <h4 className="text-xs font-semibold text-ink-3">あなたの見立て</h4>
                <p>{own}</p>
              </div>
            )}
            <div className="border-l-2 border-line-2 pl-4">
              <h4 className="text-xs font-semibold text-ink-3">AI の見立て</h4>
              <dl className="[&_dt]:mt-3 [&_dt]:text-[0.8rem] [&_dt]:text-ink-3">
                <dt>文字起こしから確かめられること（観察）</dt>
                <dd>{scene.observation || "（書かれていません）"}</dd>
                <dt>直後の相手の反応</dt>
                <dd>{scene.reaction || "（書かれていません）"}</dd>
                <dt>読み（解釈）</dt>
                <dd>{scene.reading || "（書かれていません）"}</dd>
                {scene.asChoice && (
                  <>
                    <dt>意図した選択として見ると</dt>
                    <dd>{scene.asChoice}</dd>
                  </>
                )}
              </dl>
            </div>
          </div>
          <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-3">
            「引用は原文と一致」は、引用が文字起こしのとおりであることの印で、AI の読みが合っていることの印ではありません。AI の読みと自分の見立てが違っていてかまいません。
          </p>
        </div>
      )}
    </div>
  );
}
