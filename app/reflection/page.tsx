"use client";

// 画面 2：読む（フィードバックを読み、問いに答える）。問いへの答えもこの画面で書く（11/8 に、前の画面 3「問いに答える」を入れた）。
// 上から、見出し（右に「この画面の読み方」）→ 振り返りの要点（2 文）→ 面談の地図（下に面談の流れ）→ 場面を一つ → この面談の点数 → 詳しく見る → 倫理チェック。
// 場面は、うまくいった場面も課題が見えた場面も同じ並び（11/8 に本人が決めた）：
// 「AI の見立て → 会話を確認する（押すと開く）→（課題が見えた場面だけ）考える問いと回答する → 見立ての根拠（と別の見方。押すと開く）」。
// うまくいった場面には問いを置かない（決まり 6）。見立て・要点・事実の文には発話番号を入れず、番号は「会話を確認する」と「根拠の発言」に置く。
// AI の見立てを読み、それへの自分の考えを書くことを振り返りにする（11/8 に本人が決めた）。書く欄は「回答する」で開き、答えなくても進める。
// 下に固定した「次にすること」を一つ置く。並びは設計書「画面 2 の出力の形と見せ方」。
// 点数は場面と問いの後に、太い罫で区切って置く。自分の点数を一つ決めてから AI の点数を開く（原則 1・決まり 8）。自分の点数・一言・問いへの答えは、この画面の AI の呼び出しに渡さない（決まり 10）。
// 場面の種別は、場面のボタンに最初から出す（うまくいった場面／課題が見えた場面）。倫理チェックはいつも最後の 1 行で、点にしない。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { AnalyzeResponse } from "@/engine/server.mts";
import { SPEAKER_LABELS } from "@/engine/types.mts";
import type { Scene, Transcript } from "@/engine/types.mts";
import { findUtteranceIndices } from "@/engine/utterance-no.mts";
import { AnswerBox } from "@/app/components/AnswerBox";
import { Atlas } from "@/app/components/Atlas";
import { RefText } from "@/app/components/RefText";
import { SceneLines } from "@/app/components/SceneLines";
import { ScoreTable } from "@/app/components/Scores";
import { Island } from "@/app/components/UtteranceView";
import { ANALYZE_STEPS, WaitPanel, analyzeView } from "@/app/components/WaitPanel";
import { postWithProgress } from "@/app/lib/progress-stream.mts";
import type { ProgressEvent } from "@/engine/progress.mts";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, H1, H2, LINK, NOTE, PAGE } from "@/app/components/ui";
import { chapterIndexOf, chaptersOf, refGroups, sceneSpan, spanWindow, talkByChapter } from "@/app/lib/scene-view.mts";
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
              <li>AI の見立ては解釈で、合っているとは限りません。確かめられるのは原文の会話で、「会話を確認する」を押すと、見立てに関わる会話が開きます。</li>
              <li>うまくいった場面は、AI が「どこが良かったか」を書いています。</li>
              <li>課題が見えた場面は、AI の見立てを読み、問いに自分の考えを書きます（書かなくても進めます）。見立てと違う考えも、そのまま書いてください。答えから、次に試す行動の候補を作ります。</li>
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
  const [open, setOpen] = useState<{ flow: boolean; talk: boolean; all: boolean }>({ flow: false, talk: false, all: false });
  /** 「面談の全文」で開いた話題（番号）。いくつ開いてもよい */
  const [openTopics, setOpenTopics] = useState<number[]>([]);
  /** AI の点数を開いたか。自分の点数を決めた後、本人が開く（待つ間に自分の点数を付けていても、勝手には開かない） */
  const [scoresShown, setScoresShown] = useState(false);
  const [ethicsOpen, setEthicsOpen] = useState(false);
  const sceneRef = useRef<HTMLElement>(null);

  const scene: Scene | undefined = scenes[current];
  const nextScene = scenes.findIndex((_, k) => !seen.includes(k));
  const answerOf = (q: string) => session.answers.find((x) => x.question === q)?.answer.trim() ?? "";

  const showScene = (k: number, scroll: boolean) => {
    setCurrent(k);
    setSeen((s) => (s.includes(k) ? s : [...s, k]));
    if (scroll) requestAnimationFrame(() => sceneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

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
                <SceneBody key={current} t={t} scene={scene} answered={answerOf(scene.question) !== ""} />
              </>
            )}
          </section>
        </>
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
          {/* 話題ごとの話した量。数えただけのもので、点数に入れず、良し悪しも付けない。番号は地図の下の「話題」と同じ */}
          <Drawer title="話題ごとの話した量" sub="" open={open.talk} onToggle={() => setOpen((o) => ({ ...o, talk: !o.talk }))}>
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

          {/* 面談の全文は、話題ごとに開く（一度に全部を出さない）。いくつ開いてもよい。話題の区切りが読めないときは、全部を一つで出す */}
          <Drawer title="面談の全文" sub={chapters.length > 0 ? `話題ごと・発言 ${n} 回` : `発言 ${n} 回`} open={open.all} onToggle={() => setOpen((o) => ({ ...o, all: !o.all }))}>
            {chapters.length > 0 ? (
              <>
                <p className="text-[0.86rem] leading-[1.75] text-ink-2">読みたい話題を押すと、その話題の会話が開きます。番号は、地図の下の「話題」と同じです。</p>
                <ol className="mt-3 space-y-2">
                  {chapters.map((c, i) => {
                    const on = openTopics.includes(i);
                    return (
                      <li key={c.from}>
                        <button
                          type="button"
                          onClick={() => setOpenTopics((o) => (on ? o.filter((x) => x !== i) : [...o, i]))}
                          aria-expanded={on}
                          aria-controls={`topic-${i}`}
                          className="flex w-full items-start gap-3 rounded-md border border-line-2 bg-surface px-3 py-2.5 text-left hover:border-accent"
                        >
                          <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-2 bg-paper text-xs tabular-nums text-ink-2">
                            {i + 1}
                          </span>
                          <span className="min-w-0 grow text-[0.92rem] leading-[1.65]">
                            <span className="sr-only">話題 {i + 1}：</span>
                            {c.text}
                            <span className="ml-2 whitespace-nowrap text-xs text-ink-3">{refRangeLabel(c.from, c.to)}</span>
                          </span>
                          <span className="mt-2">
                            <Chevron open={on} />
                          </span>
                        </button>
                        {on && (
                          <ol id={`topic-${i}`} className="mt-3 space-y-3 pb-3">
                            {t.utterances.slice(c.from, c.to + 1).map((u) => {
                              const k = sceneFocal.get(u.index);
                              return (
                                <li key={u.index}>
                                  <Island t={t} u={u} compact role={k !== undefined ? "focal" : "plain"} tag={k !== undefined ? `場面 ${k + 1} で引用` : quotedAll.has(u.index) ? "引用" : undefined} />
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
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
            )}
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
            <Link href="/spark" className={BTN_PRIMARY}>
              次へ　次に試すひとつ
            </Link>
          )}
          <span className="hidden text-[0.86rem] text-ink-2 sm:inline">
            {step1.noScene ? "次に試すひとつへ進みます。" : nextScene >= 0 ? `今は場面 ${current + 1}／${scenes.length}。` : `${scenes.length} つの場面を読みました。次に試すひとつを決めます。`}
          </span>
          {nextScene >= 0 && (
            <Link href="/spark" className="ml-auto text-[0.82rem] text-ink-3 underline underline-offset-[3px] hover:text-ink">
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

/** 会話のひとまとまり（発話の範囲。含む） */
type Spot = { from: number; to: number };

/**
 * 会話のひとまとまりを、原文で並べる箱。引用した発話に「引用」、見立てが触れた発話に印、前後 1 発話（広げると 3 発話）を添える。
 * 下に、この中の引用が原文と一致した印と「前後をもう少し読む」。
 */
function ConversationBox({ t, scene, span, spot, pointed, pointedTag, badge }: { t: Transcript; scene: Scene; span: SceneSpan | null; spot: Spot; pointed: number[]; pointedTag?: string; badge?: string }) {
  const n = t.utterances.length;
  const [wide, setWide] = useState(false);
  const win = spanWindow(spot, n, wide ? 3 : 1);
  const quoted = (span?.quoted ?? []).filter((i) => i >= spot.from && i <= spot.to);
  // AI が最初に挙げた引用は、それがこのまとまりにあるときだけ目立たせる
  const focal = span && span.focal >= spot.from && span.focal <= spot.to ? span.focal : -1;
  const quotesIn = scene.quotes.filter((q) => q.verified && q.index >= spot.from && q.index <= spot.to).length;
  const mark = badge ?? (quotesIn > 0 ? `この会話の引用 ${quotesIn} 件は原文と一致` : "");
  return (
    <div className="rounded-md border border-line bg-surface shadow-[0_8px_24px_-16px_rgba(29,27,24,0.25)]">
      <SceneLines t={t} span={{ from: spot.from, to: spot.to, focal, quoted }} from={win.from} to={win.to} pointed={pointed} pointedTag={pointedTag} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[0.82rem] text-ink-2 sm:px-5">
        <span>
          {mark && (
            <>
              <span aria-hidden="true" className="mr-1.5 font-bold text-accent">
                ✓
              </span>
              {mark}
            </>
          )}
        </span>
        <button type="button" onClick={() => setWide((w) => !w)} aria-expanded={wide} className="min-h-9 text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent">
          {wide ? "最初の範囲に戻す" : "前後をもう少し読む"}
        </button>
      </div>
    </div>
  );
}

/** か所ごとのボタン。押すと、その会話がすぐ下に開く。いくつ開いてもよい */
function SpotButton({ n, spot, on, onToggle, controls, note }: { n?: number; spot: Spot; on: boolean; onToggle: () => void; controls: string; note?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={on}
      aria-controls={controls}
      className={`flex min-h-9 items-center gap-2.5 rounded-md border px-3 py-1.5 text-left text-[0.9rem] transition-colors ${on ? "border-accent bg-accent-soft" : "border-line-2 bg-surface hover:border-accent"}`}
    >
      {n !== undefined && (
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent text-[0.72rem] tabular-nums text-accent">
          {n}
        </span>
      )}
      <span className="tabular-nums text-accent">{refRangeLabel(spot.from, spot.to)}</span>
      {note && <span className="text-[0.8rem] text-ink-3">{note}</span>}
      <Chevron open={on} />
    </button>
  );
}

/**
 * 「会話を確認する」。AI の見立てに関わる会話（照合済みの引用と、見立てが触れた発話）を、近いものごとのまとまりにして出す。
 * 1 か所なら、押すとその会話が開く。何か所かあれば、押すとか所ごとのボタンが並び、ボタンごとに会話が開く（11/8 に本人が決めた）。
 */
function ConversationLink({ t, scene, span, pointed }: { t: Transcript; scene: Scene; span: SceneSpan | null; pointed: number[] }) {
  const n = t.utterances.length;
  const spots = refGroups([...(span?.quoted ?? []), ...pointed], n);
  const [open, setOpen] = useState(false);
  const [openSpots, setOpenSpots] = useState<number[]>([]);
  const id = `talk-${scene.type}`;
  const verified = scene.quotes.length;
  const discarded = scene.discardedQuotes.length;
  if (spots.length === 0) return <p className="text-ink-2">この場面には、原文と一致した引用がありません。</p>;
  const whole = discarded === 0 ? `引用 ${verified} 件すべて原文と一致` : `引用 ${verified}／${verified + discarded} 件が原文と一致（一致しない引用は出していません）`;
  const label = spots.length === 1 ? `会話を確認する（${refRangeLabel(spots[0].from, spots[0].to)}）` : `会話を確認する（${spots.length} か所）`;
  return (
    <div>
      <MoreLink open={open} onToggle={() => setOpen((o) => !o)} label={label} openLabel="会話を閉じる" controls={id} />
      {open && (
        <div id={id} className="mt-2">
          {spots.length === 1 ? (
            <ConversationBox t={t} scene={scene} span={span} spot={spots[0]} pointed={pointed} badge={verified > 0 ? whole : undefined} />
          ) : (
            <>
              <p className="text-[0.86rem] leading-[1.75] text-ink-2">
                AI の見立てに関わる会話が {spots.length} か所あります。押すと、その会話が開きます。{verified > 0 && `${whole}。`}
              </p>
              <ol className="mt-2.5 space-y-2.5">
                {spots.map((sp, i) => {
                  const on = openSpots.includes(i);
                  const hasQuote = (span?.quoted ?? []).some((q) => q >= sp.from && q <= sp.to);
                  return (
                    <li key={sp.from}>
                      <SpotButton n={i + 1} spot={sp} on={on} onToggle={() => setOpenSpots((o) => (on ? o.filter((x) => x !== i) : [...o, i]))} controls={`${id}-${i}`} note={hasQuote ? "引用あり" : "見立てが触れた発言"} />
                      {on && (
                        <div id={`${id}-${i}`} className="mt-2">
                          <ConversationBox t={t} scene={scene} span={span} spot={sp} pointed={pointed} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-3">{MATCH_NOTE}</p>
        </div>
      )}
    </div>
  );
}

/** 事実の文の後に置く「根拠の発言」。番号のまとまりごとのボタンで、押すとその会話がすぐ下に開く */
function RefSpots({ t, scene, span, indices, idPrefix }: { t: Transcript; scene: Scene; span: SceneSpan | null; indices: number[]; idPrefix: string }) {
  const spots = refGroups(indices, t.utterances.length);
  const [openSpots, setOpenSpots] = useState<number[]>([]);
  if (spots.length === 0) return null;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[0.8rem] text-ink-3">根拠の発言：</span>
        {spots.map((sp, i) => {
          const on = openSpots.includes(i);
          return <SpotButton key={sp.from} spot={sp} on={on} onToggle={() => setOpenSpots((o) => (on ? o.filter((x) => x !== i) : [...o, i]))} controls={`${idPrefix}-${i}`} />;
        })}
      </div>
      {spots.map((sp, i) =>
        openSpots.includes(i) ? (
          <div key={sp.from} id={`${idPrefix}-${i}`} className="mt-2">
            <ConversationBox t={t} scene={scene} span={span} spot={sp} pointed={indices} pointedTag="根拠の発言" />
          </div>
        ) : null,
      )}
    </div>
  );
}

/**
 * 文字起こしから確かめられること（講師がしたこと・相手の反応）。AI が書いた事実。
 * 文の中には発話番号を書かせず、根拠の発言は文の後にボタンで置く（11/8）。前の作りの出力は、文の中の番号を押すと発言が開く。
 * AI が箇条書きで書いた改行は残す（一続きにすると「- 」が文の中に並んで読めない）。
 */
function Facts({ t, scene, span, id }: { t: Transcript; scene: Scene; span: SceneSpan | null; id: string }) {
  const { self, other } = SPEAKER_LABELS[t.kind];
  const rows = [
    { key: "observation", label: `${self}がしたこと`, bar: "bg-bar-self", text: scene.observation, refs: scene.refs?.observation },
    { key: "reaction", label: `${other}の反応`, bar: "bg-bar-other", text: scene.reaction, refs: scene.refs?.reaction },
  ];
  return (
    <div id={id} className="mb-2 mt-1 w-full">
      <dl className="space-y-4 border-l-2 border-line-2 pl-4 text-[0.95rem] leading-[1.8]">
        {rows.map((r) => (
          <div key={r.key}>
            <dt className="flex items-center gap-2 text-[0.8rem] font-semibold text-ink-2">
              <i aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-[2px] ${r.bar}`} />
              {r.label}
            </dt>
            <dd className="whitespace-pre-line">
              {r.text ? <RefText t={t} text={r.text} /> : "（書かれていません）"}
              {r.refs && <RefSpots t={t} scene={scene} span={span} indices={r.refs} idPrefix={`${id}-${r.key}`} />}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 pl-4 text-[0.8rem] leading-relaxed text-ink-3">
        {scene.refs ? "AI が文字起こしから書いた事実です。「根拠の発言」を押すと、その会話が開きます。" : "AI が文字起こしから書いた事実です。番号を押すと、その発言が開きます。"}
      </p>
    </div>
  );
}

const MATCH_NOTE = "「引用は原文と一致」は、引用が文字起こしのとおりであることの印で、AI の読みが合っていることの印ではありません。";

/**
 * 場面の本体。うまくいった場面も課題が見えた場面も同じ並びにする（11/8 に本人が決めた）：
 * AI の見立て → 会話を確認する（押すと開く）→（課題が見えた場面だけ）考える問いと「回答する」→ 見立ての根拠（課題が見えた場面は別の見方も）。
 * うまくいった場面には問いを置かない（決まり 6）。見立ての文には発話番号を書かせず、番号は「会話を確認する」と「根拠の発言」に置く。
 * AI の見立てを読み、それへの自分の考えを書くことを振り返りにする。見立てと違う考えも、そのまま書いてもらう。
 */
function SceneBody({ t, scene, answered }: { t: Transcript; scene: Scene; answered: boolean }) {
  const [detail, setDetail] = useState(false);
  const growth = scene.type === "次に試せる所";
  const span = sceneSpan(scene.quotes, t.utterances.length);
  // 見立てが触れた発話。新しい出力は欄に分けてある。前の作りの出力は、文の中の番号を読む
  const pointed = scene.refs ? scene.refs.reading : findUtteranceIndices(scene.reading);
  const detailId = `detail-${scene.type}`;
  return (
    <div>
      <section aria-label="AI の見立て">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-ink-3">
          AI の見立て
          <span className="rounded-[3px] border border-line-2 px-1.5 py-px text-[0.7rem] leading-tight">解釈</span>
        </h3>
        <p className="mt-1.5 whitespace-pre-line text-[1.08rem] leading-[1.85] text-pretty">{scene.reading ? <RefText t={t} text={scene.reading} /> : "（書かれていません）"}</p>
      </section>

      <div className="mt-3">
        <ConversationLink t={t} scene={scene} span={span} pointed={pointed} />
      </div>

      {growth && (
        <div className="mt-10">
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-[0.95rem] font-semibold">
            考える問い
            <span className="text-[0.82rem] font-normal text-ink-3">{answered ? "回答あり" : "答えなくても進めます"}</span>
          </h3>
          <p className="mt-2 text-[1.3rem] font-medium leading-[1.65] text-pretty">
            <RefText t={t} text={scene.question} />
          </p>
          <AnswerBox q={scene.question} label="考える問いへの回答" note="AI の見立てと違うと思う所も、そのまま書いてください。この答えから、次に試す行動の候補を作ります。" />
        </div>
      )}

      <div className={`${growth ? "mt-6" : "mt-1"} flex flex-col items-start`}>
        <MoreLink
          open={detail}
          onToggle={() => setDetail((o) => !o)}
          label={growth ? "AI の見立ての根拠と、別の見方を読む" : "AI の見立ての根拠を読む"}
          openLabel={growth ? "根拠と別の見方を閉じる" : "根拠を閉じる"}
          controls={detailId}
        />
        {detail && (
          <div id={detailId} className="w-full">
            <Facts t={t} scene={scene} span={span} id={`facts-${scene.type}`} />
            {growth && scene.asChoice && (
              <div className="mt-3 w-full rounded-lg border border-dashed border-line-2 px-4 py-3 text-[0.95rem] leading-[1.8] text-ink-2">
                <p className="text-[0.8rem] font-semibold text-ink-2">別の見方（意図した選択として見ると）</p>
                <p className="mt-1 whitespace-pre-line">
                  <RefText t={t} text={scene.asChoice} />
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
