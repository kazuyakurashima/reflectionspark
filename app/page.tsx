"use client";

// 画面 1：面談内容を入力する。文字起こしを貼り、相手の呼び名を選び、整形（工程 0）の結果を本人が確かめて直す。
// 整形の結果は、件数だけを先に出す。確かめる所（確からしさが低い発話、0b で直した所、相手が 2 人以上と推定した所）と全文は、本人が開いたときに出す。
// 見た目の決まりは app/components/ui.ts と app/globals.css。

import { useRouter } from "next/navigation";
import { useState } from "react";

import { splitUtterance } from "@/engine/transcript-edit.mts";
import type { MeetingKind, Utterance } from "@/engine/types.mts";
import type { Step0Response } from "@/engine/server.mts";
import { CheckGroups } from "@/app/components/CheckGroups";
import { CheckUtterance } from "@/app/components/CheckUtterance";
import { Collapsible } from "@/app/components/Collapsible";
import { STEP0_STEPS, WaitPanel, step0View } from "@/app/components/WaitPanel";
import { postWithProgress } from "@/app/lib/progress-stream.mts";
import { demoAfterInput } from "@/app/lib/demo-flag.mts";
import { RecordsLink } from "@/app/components/RecordViews";
import type { ProgressEvent } from "@/engine/progress.mts";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, H1, H2, LABEL, LEAD, NOTE, PAGE, SEG, segItem } from "@/app/components/ui";
import { countChecks, countToCheck, groupChecks } from "@/app/lib/check-groups.mts";
import { fetchStep0c, newSession, updateSession, useSession } from "@/app/lib/session";
import type { SessionData } from "@/app/lib/session";

const KINDS: { value: MeetingKind; label: string }[] = [
  { value: "生徒", label: "生徒面談" },
  { value: "保護者", label: "保護者面談" },
  { value: "コーチング", label: "コーチング（1on1）" },
];

/** 整形の結果が変わったときに消す、後の工程のデータ */
const cleared: Pick<SessionData, "analysis" | "selfScore" | "selfNote" | "ownViews" | "answers" | "candidates" | "spark" | "sparkSkipped" | "followUp"> = {
  analysis: null,
  selfScore: null,
  selfNote: "",
  ownViews: [],
  answers: [],
  candidates: null,
  spark: null,
  sparkSkipped: false,
  followUp: null,
};

export default function Screen1() {
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 整形を待つ間に、サーバーから届いた進み具合（いまの段階と、区切り終えた字数） */
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  /** 確かめる所を開いているか。整形はほとんど合っているので、最初は件数だけを出して畳んでおく */
  const [detail, setDetail] = useState(false);

  if (session === undefined) return <main className={`${PAGE} py-8 text-sm text-ink-2`}>読み込んでいます…</main>;

  const kind = session?.kind ?? "生徒";
  const otherName = session?.otherName ?? "";
  const raw = session?.raw ?? "";
  const transcript = session?.transcript ?? null;
  const mock = session?.mock ?? false;
  const ms = session?.step0Ms ?? null;

  /** 入力（文字起こし・場面の種類）を変えたら、整形の結果と、その後の答え・候補・Spark・追跡をすべて消す。呼び名は札なので消さない */
  const setInput = (patch: Partial<Pick<SessionData, "kind" | "otherName" | "raw">>) =>
    updateSession((s) =>
      patch.raw !== undefined || patch.kind !== undefined ? { ...s, ...patch, ...cleared, transcript: null, mock: false, step0Ms: null, demo: demoAfterInput(s.demo, patch) } : { ...s, ...patch },
    );

  const loadDemo = async () => {
    setError(null);
    const r = await fetch("/api/demo");
    const d = (await r.json()) as { kind: MeetingKind; otherName: string; raw: string };
    // サンプルの印を立てる（画面 4 で、サンプルの講師の記録を添えてよい印）
    updateSession(() => ({ ...newSession(d.kind, d.otherName, d.raw), demo: true }));
  };

  const format = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const d = await postWithProgress<Step0Response>("/api/step0", { raw, kind }, setProgress, "整形に失敗しました");
      updateSession((s) => ({ ...s, kind, otherName, raw, transcript: d.transcript, mock: d.mock, step0Ms: d.ms, ...cleared }));
      // 0c は別に回し、届いたら付ける（分析を待たせない）
      void fetchStep0c(d.transcript, (fn) => updateSession((s) => (s.transcript ? { ...s, transcript: fn(s.transcript) } : s)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 発話を直したら、分析と後の工程のデータを消す（引用が本文と合わなくなるため）。自分の点と一言は面談への自分の見方なので残す */
  const update = (next: Utterance) => {
    updateSession((s) =>
      s.transcript ? { ...s, ...cleared, selfScore: s.selfScore, selfNote: s.selfNote, transcript: { ...s.transcript, utterances: s.transcript.utterances.map((u) => (u.index === next.index ? next : u)) } } : s,
    );
  };

  const split = (u: Utterance, pos: number) => {
    updateSession((s) => (s.transcript ? { ...s, ...cleared, selfScore: s.selfScore, selfNote: s.selfNote, transcript: splitUtterance(s.transcript, u.index, pos) } : s));
  };

  const goNext = () => {
    if (!transcript) return;
    router.push("/reflection");
  };

  const groups = transcript ? groupChecks(transcript) : null;
  const checkCount = groups ? countChecks(groups) : 0;
  const toCheckCount = groups ? countToCheck(groups) : 0;

  /** 整形の結果を一行ずつ数える（0 件の行は出さない） */
  const counts = groups
    ? [
        { label: "区切りを迷った所", n: groups.unanchored.length },
        { label: "話者を迷った所", n: groups.speaker.length },
        { label: "相手が 2 人以上かもしれない所", n: groups.multiple.length },
        { label: "意味が通らず、推測を付けた所", n: groups.guessed.length },
        { label: "そのほか", n: groups.other.length },
        { label: "Claude が聞き違いを直した所", n: groups.corrected.length },
      ].filter((c) => c.n > 0)
    : [];

  return (
    <main className={PAGE}>
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className={H1}>面談内容を入力する</h1>
          {/* 記録の読み出しが開いているときだけ出る（旗が無ければ出ない） */}
          <RecordsLink className="text-[0.92rem]" />
        </div>
        <p className={LEAD}>面談の文字起こしを貼ります。ボイスメモの文字起こし（話者の無い文）のままでかまいません。</p>

        <div className="mt-7 flex flex-wrap gap-x-8 gap-y-5">
          <div>
            <p className={LABEL} id="kind-label">
              場面の種類
            </p>
            <div className={`mt-1.5 ${SEG}`} role="group" aria-labelledby="kind-label">
              {KINDS.map((k) => (
                <button key={k.value} type="button" onClick={() => kind !== k.value && setInput({ kind: k.value })} aria-pressed={kind === k.value} className={segItem(kind === k.value)}>
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={LABEL}>相手の呼び名</span>
            <input value={otherName} onChange={(e) => setInput({ otherName: e.target.value })} placeholder="例：Aさん" className={`mt-1.5 block min-h-12 w-52 ${FIELD}`} />
          </label>
        </div>

        <label className="mt-6 block">
          <span className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>文字起こし</span>
            <span className="text-xs tabular-nums text-ink-3">{[...raw].length} 字</span>
          </span>
          <textarea
            value={raw}
            onChange={(e) => setInput({ raw: e.target.value })}
            rows={transcript ? 4 : 9}
            placeholder="ここに貼る。実在の人の名前が入っていないかを確かめてください。"
            className={`mt-1.5 block w-full ${FIELD}`}
          />
        </label>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={format} disabled={busy || raw.trim() === ""} className={transcript ? BTN_SECONDARY : BTN_PRIMARY}>
            {busy ? "整形しています…" : transcript ? "もう一度整形する" : "整形する"}
          </button>
          <button type="button" onClick={loadDemo} disabled={busy} className={BTN_SECONDARY}>
            サンプルを選ぶ（Demo Mode）
          </button>
        </div>
        {!transcript && !busy && <p className="mt-3 text-[0.86rem] text-ink-3">「整形する」を押すと、Claude が発言に区切って話者を付けます（1 分ほど）。サンプルは作りものの面談で、ログイン不要で 1 から 5 まで試せます。</p>}
        {busy && (
          <WaitPanel className="mt-6" title="整形しています" estimate="1 分ほど" reopen="開き直して、もう一度「整形する」を押してください。貼った文字起こしは残っています。" steps={STEP0_STEPS} view={step0View(progress)} />
        )}
        {error && <p className="mt-3 text-[0.92rem] text-red-700">{error}　もう一度「整形する」を押すと、やり直せます。</p>}
      </section>

      {transcript && groups && (
        <section className="mt-16">
          {mock && <p className={`mb-5 ${NOTE}`}>API キーが無いので、仮の出力です。話者は文の区切りだけで交互に付けてあり、本物の整形ではありません。</p>}
          <h2 className={H2}>
            {transcript.utterances.length} の発言に区切り、話者を付けました
            {ms !== null && <span className="ml-3 text-xs font-normal tabular-nums text-ink-3">{Math.round(ms / 100) / 10} 秒</span>}
          </h2>
          <p className={LEAD}>このまま次へ進めます。何もしなければ、Claude が直した後の本文で読みます。元の文はいつも残り、次の画面でも見られます。</p>

          {counts.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-[0.92rem] text-ink-2">
              {counts.map((c) => (
                <li key={c.label}>
                  {c.label}
                  <span className="ml-2 font-semibold tabular-nums text-ink">{c.n}</span> 件
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-[0.92rem] text-ink-2">確かめる所は 0 件です。0 件は、聞き違いが無いことの証明ではありません。</p>
          )}
          {transcript.step0c === null && <p className="mt-2 text-xs text-ink-3">意味が通らない所の推測は別に読んでいます。届いたら発言に添えます（分析には使いません）。</p>}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" onClick={goNext} className={BTN_PRIMARY}>
              次へ　フィードバックを読む
            </button>
            {checkCount > 0 && (
              <button type="button" onClick={() => setDetail((d) => !d)} aria-expanded={detail} className={BTN_SECONDARY}>
                {detail ? "確かめる所を閉じる" : `確かめて直す（${toCheckCount + groups.corrected.length} 件）`}
              </button>
            )}
          </div>

          {detail && (
            <div className="mt-10">
              <p className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-3">
                <span>
                  <span className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-[5px]">太字の下線</span>　Claude が直した後の言葉
                </span>
                <span>
                  <span className="text-ink underline decoration-ink-3 decoration-wavy decoration-1 underline-offset-[5px]">波線</span>　直す前の言葉と、意味が通らないと見た所
                </span>
              </p>
              <CheckGroups t={transcript} groups={groups} onChange={update} onSplit={split} className="mt-8" />
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <button type="button" onClick={goNext} className={BTN_PRIMARY}>
                  次へ　フィードバックを読む
                </button>
                <button type="button" onClick={() => setDetail(false)} className={BTN_SECONDARY}>
                  確かめる所を閉じる
                </button>
              </div>
            </div>
          )}

          <Collapsible label={`全文を見る（発言 ${transcript.utterances.length} 回）`} openLabel="全文を閉じる" className="mt-6">
            <p className="text-[0.86rem] text-ink-3">発言にマウスを載せると、「話者を替える」「本文を直す」が出ます（スマホではいつも出ています）。</p>
            <div className="mt-4 space-y-3">
              {transcript.utterances.map((u) => (
                <CheckUtterance key={u.index} t={transcript} u={u} onChange={update} onSplit={split} />
              ))}
            </div>
          </Collapsible>
        </section>
      )}
    </main>
  );
}
