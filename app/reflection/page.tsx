"use client";

// 画面 2：読む（フィードバックを読む）。この画面は読むだけで、書く所は置かない（答えは画面 3 で書く）。
// 上から、見出し（右に「この画面の読み方」）→ 振り返りの要点（2 文）→ 面談の地図（下に面談の流れ）→ 場面を一つ → この面談の点数 → 詳しく見る → 倫理チェック。
// 場面の中は、うまくいった場面は「やりとり → どこが良かったか」、課題が見えた場面は「やりとり → AI の見立て → 考える問い」。問いは課題が見えた場面にだけ置く（決まり 6）。
// 下に固定した「次にすること」を一つ置く。並びは設計書「画面 2 の出力の形と見せ方」。
// 場面の中は、確かめられるもの（原文のやりとり）を先に、解釈（AI の見立て）を後に置く（原則 2）。課題が見えた場面の AI の見立ては本人が開き、開くのに入力は求めない。
// 点数は場面と問いの後に、太い罫で区切って置く。自分の点数を一つ決めてから AI の点数を開く（原則 1・決まり 8）。自分の点数と一言は AI に渡さない（決まり 10）。
// 場面の種別は、場面のボタンに最初から出す（うまくいった場面／課題が見えた場面）。倫理チェックはいつも最後の 1 行で、点にしない。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { AnalyzeResponse } from "@/engine/server.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { Scene, Transcript } from "@/engine/types.mts";
import { RUBRIC_ITEMS } from "@/engine/rubric.mts";
import { findUtteranceRefs } from "@/engine/utterance-no.mts";
import { Atlas } from "@/app/components/Atlas";
import { RefText } from "@/app/components/RefText";
import { SceneLines } from "@/app/components/SceneLines";
import { ScoreTable } from "@/app/components/Scores";
import { Island } from "@/app/components/UtteranceView";
import { ANALYZE_STEPS, WaitPanel, analyzeView } from "@/app/components/WaitPanel";
import { postWithProgress } from "@/app/lib/progress-stream.mts";
import type { ProgressEvent } from "@/engine/progress.mts";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, H1, H2, LINK, NOTE, PAGE } from "@/app/components/ui";
import { chapterIndexOf, chaptersOf, sceneSpan, spanWindow, talkByChapter, wideWindow } from "@/app/lib/scene-view.mts";
import type { SceneSpan } from "@/app/lib/scene-view.mts";
import { loadSession, updateSession, useSession } from "@/app/lib/session";
import { sameTranscript } from "@/app/lib/input-guard.mts";
import type { SessionData } from "@/app/lib/session";
import { countTranscript, ethicsMark } from "@/app/lib/view";
import { refListLabel, refRangeLabel, sceneTypeLabel } from "@/app/lib/words.mts";


export default function Screen2() {
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const run = useRef(0);
  const [retry, setRetry] = useState(0);
  /** 分析を待つ間に、サーバーから届いた進み具合（いまの段階と、書いている所） */
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  /** 「この画面の読み方」を開いたか。既定で閉じる */
  const [guideOpen, setGuideOpen] = useState(false);
  const transcript = session?.transcript ?? null;
  const analysis = session?.analysis ?? null;
  const firstMeeting = session?.firstMeeting ?? true;
  const sessionId = session?.id ?? null;

  useEffect(() => {
    // 自己採点・一言・見立てはこの呼び出しに入れない（決まり 10）
    if (!transcript || analysis || started.current) return;
    started.current = true;
    const thisRun = ++run.current;
    (async () => {
      try {
        const d = await postWithProgress<AnalyzeResponse>("/api/analyze", { transcript, firstMeeting }, setProgress, "分析に失敗しました");
        // 待つ間に面談が変わっていたら、この結果を保存しない（別の面談の場面を出さないため）
        const now = loadSession();
        if (!now || now.id !== sessionId || !sameTranscript(now.transcript, transcript)) {
          if (run.current === thisRun) {
            started.current = false;
            setRetry((n) => n + 1);
          }
          return;
        }
        updateSession((s) => ({ ...s, analysis: { step1: d.step1, step2: d.step2, mock: d.mock } }));
        // 保存したら印を下ろす。Next は前の画面を消さずに隠して残す（cacheComponents）ので、印が残ると、
        // 1 に戻って整形し直す・次の面談に進むなどで分析が消えたあと、この画面に戻っても分析を始めない
        if (run.current === thisRun) started.current = false;
      } catch (e) {
        setError((e as Error).message);
        started.current = false;
      }
    })();
  }, [transcript, analysis, firstMeeting, sessionId, retry]);

  if (session === undefined) return <main className={`${PAGE} text-sm text-ink-2`}>読み込んでいます…</main>;
  if (!session || !transcript) {
    return (
      <main className={PAGE}>
        <section>
          <p>先に「1 入力」で、文字起こしを貼って、話者を分けてください。</p>
          <Link href="/" className={`mt-2 inline-block ${LINK}`}>
            1 入力 へ
          </Link>
        </section>
      </main>
    );
  }
  const t = transcript;
  const counts = countTranscript(t);
  const { self, other } = SPEAKER_LABELS[t.kind];
  const selfPct = Math.round(counts.selfRatio * 100);

  return (
    <main className={PAGE}>
      <section className="pb-6">
        {/* 画面全体の読み方は、見出しの右に 1 か所だけ置く（既定で閉じる）。場面を読めるようになってから出す */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className={H1}>
            {session.otherName ? `${session.otherName}との` : ""}
            {t.kind === "コーチング" ? "1on1" : `${t.kind}面談`}
          </h1>
          {analysis && !analysis.step1.noScene && !error && (
            <button type="button" onClick={() => setGuideOpen((o) => !o)} aria-expanded={guideOpen} aria-controls="reading-guide" className={`min-h-9 text-[0.92rem] ${LINK}`}>
              {guideOpen ? "この画面の読み方を閉じる" : "この画面の読み方"}
            </button>
          )}
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[0.95rem] [&_dt]:text-xs [&_dt]:text-ink-3">
          <div>
            <dt>発言の数</dt>
            <dd>{t.utterances.length} 回</dd>
          </div>
          <div>
            <dt>話した量</dt>
            <dd className="flex items-center gap-2.5">
              <span>
                {self} {selfPct}%
              </span>
              <span className="flex h-2 w-24 overflow-hidden rounded-full" aria-hidden="true">
                <i className="block bg-bar-self" style={{ width: `${selfPct}%` }} />
                <i className="block grow bg-bar-other" />
              </span>
              <span>
                {other} {100 - selfPct}%
              </span>
            </dd>
          </div>
          <div>
            <dt>読み方</dt>
            <dd>{firstMeeting ? "初回の面談として" : "続きの面談として（前回決めたことに触れたかも見ます）"}</dd>
          </div>
        </dl>
        {guideOpen && analysis && !analysis.step1.noScene && !error && (
          <div id="reading-guide" className="mt-5 rounded-md bg-accent-soft px-5 py-4">
            <ul className="list-disc space-y-1.5 pl-5 text-[0.92rem] leading-[1.75] text-ink-2">
              <li>場面ごとに、番号の順に読みます。この画面で書く所はありません。1 の原文のやりとりが、確かめられるものです。</li>
              <li>うまくいった場面は、2 に AI が「どこが良かったか」を書いています。</li>
              <li>課題が見えた場面は、2 の AI の見立てを開く前に、自分ならどう読むかを考えてみてください（開かなくても進めます）。3 の問いには次の画面「3 問いに答える」で答え、その答えから次に試す行動の候補を作ります。</li>
            </ul>
          </div>
        )}
      </section>

      {error ? (
        <div className="rounded-md border border-red-200 bg-surface px-4 py-3 text-[0.95rem]">
          <p className="text-red-700">分析できませんでした：{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setProgress(null);
              setRetry((n) => n + 1);
            }}
            className={`mt-2 ${BTN_SMALL}`}
          >
            もう一度分析する
          </button>
        </div>
      ) : !analysis ? (
        <section className="py-6">
          <WaitPanel title="AI が面談を読んでいます" estimate="1 分ほど" steps={ANALYZE_STEPS} view={analyzeView(progress)} />
          <div className="mt-6 rounded-md border border-line bg-surface px-5 py-4">
            <SelfScore selfScore={session.selfScore} lead="待つ間に、この面談の自分の点数を付けておけます（付けなくても読めます）。あとで AI の点数と並べます。" confirmLabel="待つ" canRedo />
          </div>
        </section>
      ) : (
        <Feedback t={t} a={analysis} session={session} />
      )}
    </main>
  );
}

/**
 * 自分の点数（10 点満点、一つ）。AI に渡さない（決まり 10）。
 * 数字を選んだだけでは決まらず、「この点に決める」を押して決める（押し間違いを直せるように）。
 * AI の点数は、自分の点数を決めた後に並べる（原則 1）。AI の点数を見た後は変えない。
 */
function SelfScore({
  selfScore,
  lead,
  confirmLabel,
  canRedo,
  onDecided,
}: {
  selfScore: number | null;
  lead: string;
  confirmLabel: string;
  /** 決めた後に付け直せるか（AI の点数をまだ見ていない間だけ） */
  canRedo: boolean;
  /** 決めたときに呼ぶ（画面 2 では、決めたらそのまま AI の点数を開く） */
  onDecided?: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  if (selfScore !== null) {
    return (
      <p className="text-[0.95rem]">
        自分の点数：<span className="text-lg font-semibold tabular-nums">{selfScore}</span>／10
        {canRedo && (
          <button type="button" onClick={() => updateSession((s) => ({ ...s, selfScore: null }))} className="ml-3 text-[0.86rem] text-accent underline decoration-accent/40 underline-offset-[3px]">
            付け直す
          </button>
        )}
      </p>
    );
  }
  return (
    <div>
      <p className="text-[0.95rem]">{lead}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="この面談の自分の点数（10 点満点）">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setPicked(v)}
            aria-pressed={picked === v}
            className={`h-11 w-10 rounded-md border text-[0.95rem] tabular-nums ${picked === v ? "border-accent bg-accent text-white" : "border-line-2 bg-paper text-ink-2 hover:border-ink-2"}`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          disabled={picked === null}
          onClick={() => {
            if (picked === null) return;
            updateSession((s) => ({ ...s, selfScore: picked }));
            onDecided?.();
          }}
          className={BTN_SECONDARY}
        >
          {picked === null ? "点数を選んでください" : `${picked} 点に決めて、${confirmLabel}`}
        </button>
        <span className="text-xs text-ink-3">10 点満点で一つ。決めるまでは選び直せます。この点数は AI に渡しません。</span>
      </div>
    </div>
  );
}

/** 話した量の棒（本人の割合を左から）。数えただけのもので、良し悪しの色は付けない */
function TalkBar({ self, other, pct }: { self: string; other: string; pct: number }) {
  return (
    <div className="mt-1.5 flex items-center gap-3 text-[0.82rem] tabular-nums text-ink-2">
      <span className="w-[5.5rem] shrink-0">
        {self} {pct}%
      </span>
      <span className="flex h-2 min-w-0 max-w-xs grow overflow-hidden rounded-full" aria-hidden="true">
        <i className="block bg-bar-self" style={{ width: `${pct}%` }} />
        <i className="block grow bg-bar-other" />
      </span>
      <span className="w-[5.5rem] shrink-0">
        {other} {100 - pct}%
      </span>
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

/** 場面の中の手順一つ。番号は、読む順（やりとり → AI の見立て → 問い） */
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
  const talk = talkByChapter(chapters, t.utterances, self);

  const [current, setCurrent] = useState(0);
  const [seen, setSeen] = useState<number[]>([0]);
  const [wide, setWide] = useState(false);
  const [aiOpen, setAiOpen] = useState<number[]>([]);
  const [open, setOpen] = useState<{ flow: boolean; owner: boolean; talk: boolean; all: boolean }>({ flow: false, owner: false, talk: false, all: false });
  /** AI の点数を開いたか。自分の点数を決めた後、本人が開く（待つ間に自分の点数を付けていても、勝手には開かない） */
  const [scoresShown, setScoresShown] = useState(false);
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
      {a.mock && <p className={`mb-6 ${NOTE}`}>API キーが無いので、仮の出力です。引用は本文の発言ですが、読みと問いと点数は仮の文です。</p>}

      {/* 振り返りの要点（AI が書く 2 文）は最初から全部見せる。無いときは、選んだ場面を一行で言う。
          面談の中身の要約ではない（それは地図の下の「面談の流れ」）。AI の読みと分かるように「AI」を添える（原則 2） */}
      {(step1.summary || !step1.noScene) && (
        <section aria-label="振り返りの要点">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-ink-3">
            振り返りの要点
            <span className="rounded-[3px] border border-line-2 px-1.5 py-px text-[0.7rem] leading-tight">AI</span>
          </h2>
          <p className="mt-1.5 text-[1.08rem] leading-[1.85] text-pretty">
            {step1.summary ? <RefText t={t} text={step1.summary} /> : `AI がこの面談から、${scenes.map((sc) => sceneTypeLabel(sc.type)).join("と、")}を選びました。`}
          </p>
          {session.spark && (
            <p className="mt-3 text-[0.95rem] text-ink-2">
              次に試すひとつ：
              <Link href="/spark" className="font-semibold text-ink underline decoration-amber-500 underline-offset-4">
                {session.spark.sentence}
              </Link>
            </p>
          )}
        </section>
      )}

      {step1.noScene ? (
        <section className="py-6">
          <p>根拠のある場面が無いとされました：{step1.noScene}</p>
        </section>
      ) : (
        <>
          {/* 地図（形）のすぐ下に、話題ごとの一覧（中身）を置く。既定で閉じる。番号は地図の下の「話題」の帯と同じ */}
          <section className="mt-12" aria-label="面談の地図">
            <Atlas t={t} spans={spans} sceneNames={scenes.map((sc) => sceneTypeLabel(sc.type))} current={current} chapters={chapters} onScene={(k) => showScene(k, false)} />
            {step1.flow.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, flow: !o.flow }))}
                  aria-expanded={open.flow}
                  aria-controls="meeting-flow"
                  className="flex min-h-9 items-center gap-2.5 text-[0.92rem] text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent"
                >
                  <Chevron open={open.flow} />
                  {open.flow ? "面談の流れを閉じる" : `面談の流れを見る（話題 ${step1.flow.length} つ）`}
                </button>
                {open.flow && (
                  <ol id="meeting-flow" className="mt-3 space-y-3 border-l border-line-2 pl-4">
                    {step1.flow.map((f, i) => {
                      const c = chapters[i];
                      return (
                        <li key={i} className="flex gap-3">
                          <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface text-xs tabular-nums text-ink-2">
                            {i + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="sr-only">話題 {i + 1}：</span>
                            <RefText t={t} text={c ? c.text : f} />
                            {c && <span className="block text-xs text-ink-3">{refRangeLabel(c.from, c.to)}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}
          </section>

          <section ref={sceneRef} className="mt-16 scroll-mt-6" aria-label={`場面 ${current + 1}`}>
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
                    className={`flex items-center gap-3 rounded-md border px-4 py-2.5 text-left transition-colors ${active ? "border-accent bg-accent text-white" : "border-line-2 bg-surface text-ink-2 hover:border-accent"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-semibold tabular-nums ${active ? "border-white bg-white text-accent" : "border-accent text-accent"}`}
                    >
                      {k + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs leading-snug opacity-85">
                        場面 {k + 1}　{w ? refRangeLabel(w.from, w.to) : "引用なし"}
                        {!active && seen.includes(k) ? "　読んだ" : ""}
                      </span>
                      <span className="block font-semibold leading-snug">{sceneTypeLabel(scenes[k].type)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {scene && (
              <>
                <p className="mb-8 mt-6 text-[1.08rem] leading-[1.8]">
                  <RefText t={t} text={scene.context} />
                </p>

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

                {scene.type === "よく表れた所" ? (
                  // うまくいった場面は、問いで自己分析させず、どこが良かったかを最初から見せる
                  <Step n={2} title="どこが良かったか" note="AI の見立て" last>
                    <AiView key={current} t={t} scene={scene} strength open onToggle={() => {}} />
                  </Step>
                ) : (
                  <>
                    <Step n={2} title="AI の見立て">
                      <AiView key={current} t={t} scene={scene} strength={false} open={aiOpen.includes(current)} onToggle={() => setAiOpen((o) => (o.includes(current) ? o.filter((k) => k !== current) : [...o, current]))} />
                    </Step>

                    <Step n={3} title="考える問い" note="答えは次の画面で書きます" last>
                      <p className="text-[1.38rem] font-medium leading-[1.65] text-pretty">
                        <RefText t={t} text={scene.question} />
                      </p>
                    </Step>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}

      {step1.extraQuestion && (
        <section className="mt-16" aria-label="もう一つの問い">
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-[0.95rem] font-semibold">
            もう一つの問い<span className="text-[0.82rem] font-normal text-ink-3">面談の全体から。答えは次の画面で書きます</span>
          </h2>
          <p className="mt-2 text-[1.12rem] font-medium leading-[1.7] text-pretty">
            <RefText t={t} text={step1.extraQuestion} />
          </p>
        </section>
      )}

      {/* 点数は場面と問いの後に、太い罫で区切って置く。自分の点数を一つ決めてから、AI の点数を開く */}
      <section className="mt-20 border-t-2 border-ink-2 pt-7" aria-labelledby="score-heading">
        <h2 id="score-heading" className={H2}>
          この面談の点数
        </h2>
        {session.selfScore === null ? (
          <div className="mt-3">
            <SelfScore selfScore={null} lead="自分の点数を一つ決めると、AI の点数が項目ごとに開きます。AI の点数を見た後は、自分の点数は変えられません。" confirmLabel="AI の点数を見る" canRedo={false} onDecided={() => setScoresShown(true)} />
          </div>
        ) : !scoresShown ? (
          <div className="mt-3">
            <p className="text-[0.95rem]">
              自分の点数：<span className="text-lg font-semibold tabular-nums">{session.selfScore}</span>／10
            </p>
            <button type="button" onClick={() => setScoresShown(true)} className={`mt-3 ${BTN_SECONDARY}`}>
              AI の点数を見る
            </button>
          </div>
        ) : (
          <>
            <ScoreTable items={step2.items} total={step2.total} t={t} selfScore={session.selfScore} />
            <label className="mt-5 block text-[0.86rem] text-ink-2">
              自分の点数への一言（書かなくてもかまいません。AI に渡しません）
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
      </section>

      <section className="mt-16" aria-labelledby="more-heading">
        <h2 id="more-heading" className="text-[0.95rem] font-semibold">
          詳しく見る
        </h2>
        <p className="mb-3 text-[0.86rem] text-ink-2">必要なときに開きます。開かなくても、次へ進めます。</p>
        <div className="border-t border-line">
          {/* 気づきの持ち主は AI の判定なので、場面の前（地図の下）には出さず、ここに置く */}
          <Drawer title="気づきの持ち主" sub="" open={open.owner} onToggle={() => setOpen((o) => ({ ...o, owner: !o.owner }))}>
            <p className="text-[0.95rem]">面談の最後に残ったテーマを主に言葉にしたのは：{step2.insightOwner}</p>
          </Drawer>

          {/* 話題ごとの話した量。数えただけのもので、点数に入れず、良し悪しも付けない。番号は地図の下の「話題」と同じ */}
          <Drawer title="話題ごとの話した量" sub="点数には入りません" open={open.talk} onToggle={() => setOpen((o) => ({ ...o, talk: !o.talk }))}>
            {talk.length > 0 ? (
              <>
                <p className="text-[0.86rem] leading-[1.75] text-ink-2">
                  話題ごとに、{self}と{other}が話した文字数の割合です。番号は、地図の下の「話題」と同じです。
                </p>
                <ol className="mt-4 space-y-4">
                  {talk.map((c, i) => {
                    const pct = Math.round(c.selfRatio * 100);
                    const here = scenes.map((_, k) => k).filter((k) => spans[k] && chapterIndexOf(chapters, spans[k].focal) === i);
                    return (
                      <li key={c.from} className="flex gap-3">
                        <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface text-xs tabular-nums text-ink-2">
                          {i + 1}
                        </span>
                        <div className="min-w-0 grow">
                          <p className="text-[0.92rem] leading-[1.65]">
                            <span className="sr-only">話題 {i + 1}：</span>
                            <RefText t={t} text={c.text} />
                            <span className="ml-2 whitespace-nowrap text-xs text-ink-3">{refRangeLabel(c.from, c.to)}</span>
                            {here.map((k) => (
                              <span key={k} className="ml-2 whitespace-nowrap rounded-full border border-accent px-2 py-px text-[0.72rem] text-accent">
                                場面 {k + 1}
                              </span>
                            ))}
                          </p>
                          <TalkBar self={self} other={other} pct={pct} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-5 flex gap-3 border-t border-line pt-4">
                  <span aria-hidden="true" className="w-7 shrink-0" />
                  <div className="min-w-0 grow">
                    <p className="text-[0.92rem] font-semibold">面談の全体</p>
                    <TalkBar self={self} other={other} pct={selfPct} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-[0.86rem] leading-[1.75] text-ink-2">話題の区切りが読めなかったので、面談の全体だけを出します（文字数）。</p>
                <TalkBar self={self} other={other} pct={selfPct} />
              </>
            )}
          </Drawer>

          <Drawer title="面談の全文" sub={`発言 ${n} 回`} open={open.all} onToggle={() => setOpen((o) => ({ ...o, all: !o.all }))}>
            <ol className="space-y-3">
              {t.utterances.map((u) => {
                const k = sceneFocal.get(u.index);
                return (
                  <li key={u.index}>
                    <Island t={t} u={u} compact role={k !== undefined ? "focal" : "plain"} tag={k !== undefined ? `場面 ${k + 1} で引用` : quotedAll.has(u.index) ? "引用" : undefined} />
                  </li>
                );
              })}
            </ol>
          </Drawer>
        </div>

        <p className="mt-6 text-[0.86rem] text-ink-2">
          <span className="mr-1.5 font-semibold text-ink">{ethicsMark(step2.ethics.level)} 倫理チェック</span>
          {step2.ethics.level === "所属の手順" ? step2.ethics.text : `${step2.ethics.level}。`}点数にはせず、合計にも入れません。
          {step2.ethics.level !== "問題なし" && step2.ethics.level !== "所属の手順" && (
            <>
              <button type="button" onClick={() => setEthicsOpen((o) => !o)} aria-expanded={ethicsOpen} className="ml-2 text-accent underline decoration-accent/40 underline-offset-[3px]">
                {ethicsOpen ? "理由を閉じる" : "理由を開く"}
              </button>
              {ethicsOpen && (
                <span className="mt-1 block">
                  {step2.ethics.text}
                  {step2.ethics.viewpoint && `（観点：${step2.ethics.viewpoint}）`}
                  {step2.ethics.utterances.length > 0 && `（${refListLabel(step2.ethics.utterances)}）`}
                </span>
              )}
            </>
          )}
        </p>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 mt-10 border-t border-line bg-paper/90 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {nextScene >= 0 ? (
            <button type="button" onClick={() => showScene(nextScene, true)} className={BTN_PRIMARY}>
              場面 {nextScene + 1} を読む
            </button>
          ) : (
            <Link href="/answers" className={BTN_PRIMARY}>
              次へ　問いに答える
            </Link>
          )}
          <span className="hidden text-[0.86rem] text-ink-2 sm:inline">
            {step1.noScene ? "問いに、自分の言葉で答えます。" : nextScene >= 0 ? `今は場面 ${current + 1}／${scenes.length}。読み終えたら、問いに自分の言葉で答えます。` : `${scenes.length} つの場面を読みました。問いに、自分の言葉で答えます。`}
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

/** 押すと開く小さなリンク（AI の見立ての中の「事実」「別の見方」） */
function MoreLink({ open, onToggle, label, openLabel, controls }: { open: boolean; onToggle: () => void; label: string; openLabel: string; controls: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls} className="flex min-h-9 items-center gap-2.5 text-[0.9rem] text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent">
      <Chevron open={open} />
      {open ? openLabel : label}
    </button>
  );
}

/**
 * AI の見立て。最初に見せるのは AI の読み（解釈）だけ。色の付いた箱に入れ、AI の解釈だと分かるようにする（原則 2）。
 * 文字起こしで確かめられること（講師がしたこと・相手の反応）と、別の見方（意図した選択として見ると）は、押すと開く。
 * 原文のやりとりは、この前の「やりとりを読む」にある。文の中の発言の番号を押すと、その発言がその場で開く。
 * うまくいった場面（strength）は「どこが良かったか」として最初から開く。課題が見えた場面は閉じて始め、開く前に自分の読みを促す。
 */
function AiView({ t, scene, strength, open, onToggle }: { t: Transcript; scene: Scene; strength: boolean; open: boolean; onToggle: () => void }) {
  const { self, other } = SPEAKER_LABELS[t.kind];
  const [facts, setFacts] = useState(false);
  const [alt, setAlt] = useState(false);
  const shown = strength || open;
  const factsId = `facts-${scene.type}`;
  const altId = `alt-${scene.type}`;
  return (
    <div>
      {!strength && (
        <>
          {!open && <p className="mb-3 text-[0.9rem] leading-[1.75] text-ink-2">開く前に、自分ならどう読むかを考えてみてください。AI の読みと違っていてかまいません。</p>}
          <button type="button" onClick={onToggle} aria-expanded={open} className={`gap-3 ${BTN_SECONDARY}`}>
            <Chevron open={open} />
            {open ? "AI の見立てを閉じる" : "AI の見立てを読む"}
          </button>
        </>
      )}
      {shown && (
        <div className={strength ? "" : "mt-5"}>
          {scene.items.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="関わる項目">
              {scene.items.map((i) => (
                <li key={i} className="rounded-full border border-line-2 bg-surface px-2.5 py-px text-[0.8rem] text-ink-2">
                  項目 {i}　{RUBRIC_ITEMS.find((r) => r.n === i)?.name ?? ""}
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-lg bg-accent-soft px-4 py-3.5 sm:px-5">
            <p className="flex items-center gap-2 text-[0.8rem] font-semibold text-accent">
              {strength ? "良かった所" : "AI の読み"}
              <span className="rounded-full border border-accent/30 px-2 text-[0.72rem] font-normal">解釈</span>
            </p>
            <p className="mt-1.5 text-[1.06rem] font-medium leading-[1.85] text-pretty">{scene.reading ? <RefText t={t} text={scene.reading} /> : "（書かれていません）"}</p>
          </div>

          <div className="mt-2 flex flex-col items-start">
            <MoreLink open={facts} onToggle={() => setFacts((f) => !f)} label="文字起こしで事実を確かめる" openLabel="事実を閉じる" controls={factsId} />
            {facts && (
              <div id={factsId} className="mb-2 mt-1 w-full">
                <dl className="space-y-3 border-l-2 border-line-2 pl-4 text-[0.95rem] leading-[1.8]">
                  <div>
                    <dt className="flex items-center gap-2 text-[0.8rem] font-semibold text-ink-2">
                      <i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px] bg-bar-self" />
                      {self}がしたこと
                    </dt>
                    <dd>{scene.observation ? <RefText t={t} text={scene.observation} /> : "（書かれていません）"}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-2 text-[0.8rem] font-semibold text-ink-2">
                      <i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px] bg-bar-other" />
                      {other}の反応
                    </dt>
                    <dd>{scene.reaction ? <RefText t={t} text={scene.reaction} /> : "（書かれていません）"}</dd>
                  </div>
                </dl>
                <p className="mt-2 pl-4 text-[0.8rem] leading-relaxed text-ink-3">AI が文字起こしから書いた事実です。番号を押すと、その発言が開きます。</p>
              </div>
            )}
            {scene.asChoice && (
              <>
                <MoreLink open={alt} onToggle={() => setAlt((a) => !a)} label="別の見方を見る（意図した選択として見ると）" openLabel="別の見方を閉じる" controls={altId} />
                {alt && (
                  <div id={altId} className="mt-1 w-full rounded-lg border border-dashed border-line-2 px-4 py-3 text-[0.95rem] leading-[1.8] text-ink-2">
                    <RefText t={t} text={scene.asChoice} />
                  </div>
                )}
              </>
            )}
          </div>
          <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-3">
            「引用は原文と一致」は、引用が文字起こしのとおりであることの印で、AI の読みが合っていることの印ではありません。
          </p>
        </div>
      )}
    </div>
  );
}
