"use client";

// 画面 1：面談内容を入力する。文字起こしを貼り、相手の呼び名を選び、整形（工程 0）の結果を本人が確かめて直す。
// 次の面談も、ここから入る。前の面談で決めたひとつを持ち越しているときは、それを上に出し、整形のあと先に確かめへ進む（app/lib/next-meeting.mts）。
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
import { sameInput, sameLine } from "@/app/lib/input-guard.mts";
import { RecordsLink } from "@/app/components/RecordViews";
import type { ProgressEvent } from "@/engine/progress.mts";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, H1, H2, LABEL, LEAD, NOTE, PAGE, QUIET_LINK, SEG, SPARK_BOX, segItem } from "@/app/components/ui";
import { countChecks, countToCheck, groupChecks } from "@/app/lib/check-groups.mts";
import { afterFormatHref, backToPrevMeeting, dropPrev, sampleEntry, withOtherName } from "@/app/lib/next-meeting.mts";
import { fetchStep0c, loadSession, newSession, saveSession, updateSession, useSession } from "@/app/lib/session";
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
  /** サンプルを取りに行っている間（整形と入力を止める。応答の順番で、貼った文に印が移らないように） */
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState(false);
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
  /** 前の面談（あれば）と、そこで決めて持ち越したひとつ */
  const prev = session?.prev ?? null;
  const prevSpark = prev?.spark ?? null;
  const sample = sampleEntry(session);

  /** 入力（文字起こし・場面の種類）を変えたら、整形の結果と、その後の答え・候補・Spark・確かめをすべて消す。持ち越したひとつは消さない。
   *  呼び名は札なので消さない（前の面談と同じ呼び名かで、続きの面談として読むかが決まる） */
  const setInput = (patch: Partial<Pick<SessionData, "kind" | "otherName" | "raw">>) =>
    updateSession((s) => {
      if (patch.raw !== undefined || patch.kind !== undefined) return { ...s, ...patch, ...cleared, transcript: null, mock: false, step0Ms: null, demo: demoAfterInput(s.demo, patch) };
      return patch.otherName !== undefined ? withOtherName(s, patch.otherName) : { ...s, ...patch };
    });

  const loadDemo = async () => {
    setError(null);
    setDemoError(false);
    setLoadingDemo(true);
    try {
      const r = await fetch(sample === "next" ? "/api/demo/2" : "/api/demo");
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { kind: MeetingKind; otherName: string; raw: string };
      if (sample === "next") {
        // サンプルの続き。前の面談と持ち越したひとつは残し、入力だけを入れ替える。待つ間に貼る欄が変わっていたら、上書きしない
        updateSession((s) => (s.raw === raw && s.prev ? withOtherName({ ...s, ...cleared, kind: d.kind, raw: d.raw, transcript: null, mock: false, step0Ms: null, demo: true }, d.otherName) : s));
        return;
      }
      // サンプルの印を立てる（画面 4 で、サンプルの講師の記録を添えてよい印）。待つ間に貼る欄が変わっていたら、上書きしない
      updateSession((s) => (s.raw === raw ? { ...newSession(d.kind, d.otherName, d.raw), demo: true } : s));
    } catch {
      setDemoError(true);
    } finally {
      setLoadingDemo(false);
    }
  };

  const format = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    const stamp = { id: session?.id ?? "", raw, kind };
    try {
      const d = await postWithProgress<Step0Response>("/api/step0", { raw, kind }, setProgress, "話者を分けられませんでした");
      // 頼んだ時と同じ入力のときだけ保存する（待つ間にサンプルを選んだ・貼り直したときは、この結果を捨てる）
      const now = loadSession();
      if (!now || !sameInput(stamp, now)) return;
      updateSession((s) => ({ ...s, transcript: d.transcript, mock: d.mock, step0Ms: d.ms, ...cleared }));
      // 0c は別に回し、届いたら付ける（分析を待たせない）
      void fetchStep0c(d.transcript, (fn) => updateSession((s) => (s.transcript ? { ...s, transcript: fn(s.transcript) } : s)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 発話を直しても残すもの。自分の点と一言、確かめの自分の判定は、面談への自分の見方なので残す。AI の判定は消して読み直す（追った回数は二重に数えない） */
  const kept = (s: SessionData) => ({ selfScore: s.selfScore, selfNote: s.selfNote, followUp: s.followUp ? { ...s.followUp, result: null } : null });

  /** 発話を直したら、分析と後の工程のデータを消す（引用が本文と合わなくなるため）。話者も本文も変わらない（「合っている」で印だけを付けた）ときは消さない */
  const update = (next: Utterance) => {
    updateSession((s) => {
      if (!s.transcript) return s;
      const before = s.transcript.utterances.find((u) => u.index === next.index);
      const transcript = { ...s.transcript, utterances: s.transcript.utterances.map((u) => (u.index === next.index ? next : u)) };
      return before && sameLine(before, next) ? { ...s, transcript } : { ...s, ...cleared, ...kept(s), transcript };
    });
  };

  const split = (u: Utterance, pos: number) => {
    updateSession((s) => (s.transcript ? { ...s, ...cleared, ...kept(s), transcript: splitUtterance(s.transcript, u.index, pos) } : s));
  };

  const goNext = () => {
    if (!transcript) return;
    // 持ち越したひとつがあれば、読む前に確かめる
    router.push(afterFormatHref(session));
  };
  const nextLabel = prevSpark ? "次へ　前回のひとつを確かめる" : "次へ　フィードバックを読む";

  /** 前の面談に戻る（この面談の入力は捨てる）。戻り先は、ひとつを決めた画面 4 */
  const backToPrev = () => {
    if (!session?.prev) return;
    saveSession(backToPrevMeeting(session));
    router.push("/spark");
  };

  const groups = transcript ? groupChecks(transcript) : null;
  const checkCount = groups ? countChecks(groups) : 0;
  const toCheckCount = groups ? countToCheck(groups) : 0;

  return (
    <main className={PAGE}>
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className={H1}>{prev ? "次の面談を入力する" : "面談内容を入力する"}</h1>
          {/* 記録の読み出しが開いているときだけ出る（旗が無ければ出ない） */}
          <RecordsLink className="text-[0.92rem]" />
        </div>
        <p className={LEAD}>
          {prev ? "次の面談が終わったら、その文字起こしを貼り付けます。" : "面談の文字起こしを貼り付けます。"}
        </p>

        {prev && (
          <div className="mt-6">
            {prevSpark ? (
              <div className={SPARK_BOX}>
                <p className="text-xs font-semibold text-amber-900">
                  前回決めた、次に試すひとつ{prevSpark.timesFollowed > 0 ? `（${prevSpark.timesFollowed} 回追った）` : ""}
                </p>
                <p className="mt-1 text-[1.08rem] font-semibold leading-[1.7]">{prevSpark.sentence}</p>
                {prevSpark.criterion && <p className="mt-1.5 text-[0.92rem] text-ink-2">できたかの基準：{prevSpark.criterion}</p>}
                <p className="mt-2 text-[0.86rem] text-ink-2">話者を分けたあと、読む前に、このひとつが今回の面談でどう現れたかを確かめます。</p>
              </div>
            ) : (
              <p className={NOTE}>前の面談では、行動を見送りました。確かめるものはありません。</p>
            )}
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 px-1 text-[0.86rem]">
              <button type="button" onClick={backToPrev} disabled={busy || loadingDemo} className={QUIET_LINK}>
                前の面談に戻る（この入力は消えます）
              </button>
              <button type="button" onClick={() => updateSession(dropPrev)} disabled={busy || loadingDemo} className={QUIET_LINK}>
                持ち越さずに、新しく始める
              </button>
            </p>
          </div>
        )}

        <div className="mt-7 flex flex-wrap gap-x-8 gap-y-5">
          <div>
            <p className={LABEL} id="kind-label">
              場面の種類
            </p>
            <div className={`mt-1.5 ${SEG}`} role="group" aria-labelledby="kind-label">
              {KINDS.map((k) => (
                <button key={k.value} type="button" disabled={busy || loadingDemo} onClick={() => kind !== k.value && setInput({ kind: k.value })} aria-pressed={kind === k.value} className={segItem(kind === k.value)}>
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
        {prev && prev.session.otherName.trim() !== "" && (
          <p className="mt-2 text-xs text-ink-3">前回の相手は「{prev.session.otherName.trim()}」。同じ呼び名を入れると、続きの面談として読みます（前回決めたことに触れたかも見ます）。</p>
        )}

        <label className="mt-6 block">
          <span className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>文字起こし</span>
            <span className="text-xs tabular-nums text-ink-3">{[...raw].length} 字</span>
          </span>
          <textarea
            value={raw}
            onChange={(e) => setInput({ raw: e.target.value })}
            readOnly={busy || loadingDemo}
            // 整形している間（読み取り専用）と整形の後は、整形の後と同じ高さに縮め、待つ間の進み具合と結果を上に寄せる
            rows={transcript || busy ? 4 : 9}
            placeholder="ここに貼る。実在の人の名前が入っていないかを確かめてください。"
            className={`mt-1.5 block w-full ${FIELD}`}
          />
        </label>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={format} disabled={busy || loadingDemo || raw.trim() === ""} className={transcript ? BTN_SECONDARY : BTN_PRIMARY}>
            {busy ? "話者を分けています…" : transcript ? "もう一度分ける" : "話者を分ける"}
          </button>
          {sample !== "none" && (
            <button type="button" onClick={loadDemo} disabled={busy || loadingDemo} className={BTN_SECONDARY}>
              {sample === "next" ? "サンプルの続きを選ぶ（Demo Mode）" : "サンプルを選ぶ（Demo Mode）"}
            </button>
          )}
        </div>
        {!transcript && !busy && (
          <p className="mt-3 text-[0.86rem] text-ink-3">
            「話者を分ける」を押すと、Claude が発言に区切って話者を付けます（1 分ほど）。
            {sample === "first" && "サンプルは作りものの面談で、ログイン不要で、次の面談の確かめまで試せます。"}
            {sample === "next" && "サンプルの続きは、前の面談と同じ相手との、作りものの面談です。"}
          </p>
        )}
        {busy && (
          <WaitPanel className="mt-6" title="話者を分けています" estimate="1 分ほど" reopen="開き直して、もう一度「話者を分ける」を押してください。貼った文字起こしは残っています。" steps={STEP0_STEPS} view={step0View(progress)} />
        )}
        {error && <p className="mt-3 text-[0.92rem] text-red-700">{error}　もう一度「話者を分ける」を押すと、やり直せます。</p>}
        {demoError && <p className="mt-3 text-[0.92rem] text-red-700">サンプルを読めませんでした。もう一度押すと、やり直せます。</p>}
      </section>

      {transcript && groups && (
        <section className="mt-16">
          {mock && <p className={`mb-5 ${NOTE}`}>API キーが無いので、仮の出力です。話者は文の区切りだけで交互に付けてあり、Claude が分けたものではありません。</p>}
          {/* 見出しは短く。話者・推測・聞き違いの直しの件数は「文字起こしを確かめる」のボタンにまとめる */}
          <h2 className={H2}>
            話者を分けました
            {ms !== null && <span className="ml-3 text-xs font-normal tabular-nums text-ink-3">{Math.round(ms / 100) / 10} 秒</span>}
          </h2>
          {checkCount === 0 && <p className="mt-3 text-[0.92rem] text-ink-2">確かめる所は 0 件です。0 件は、聞き違いが無いことの証明ではありません。</p>}
          {transcript.step0c === null && <p className="mt-2 text-xs text-ink-3">意味が通らない所の推測は別に読んでいます。届いたら発言に添えます（分析には使いません）。</p>}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" onClick={goNext} className={BTN_PRIMARY}>
              {nextLabel}
            </button>
            {checkCount > 0 && (
              <button type="button" onClick={() => setDetail((d) => !d)} aria-expanded={detail} className={BTN_SECONDARY}>
                {detail ? "確かめる所を閉じる" : `文字起こしを確かめる（${toCheckCount + groups.corrected.length} か所）`}
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
                  {nextLabel}
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
