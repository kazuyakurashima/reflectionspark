// LLM 判定（軸 3 問いの質、軸 4 行動の具体性、軸 10 引用が読みを支えるか、軸 12 推測の意味の一致）。
// 観点と 1〜5 の基準を明記し、判定に理由を一行付けさせる（docs/設計書.md「読み方と決まり」）。
// 人の抜き取りで確かめるときは、人が先に判定を書いてから AI の判定を見る。
// 軸 12 の推測の意味は「崩れ」だけに回す。「抜け」（言葉が抜けていて推測できないと答えた所）と「話者の取り違え」は回さない（axes.mts の needsMeaningJudge）。

import { callStructured, JUDGE_MODEL } from "../../engine/claude.mts";
import type { CallMeta, Candidate, Scene, Transcript } from "../../engine/types.mts";
import { blockLabel, utteranceLabel } from "../../engine/utterance-no.mts";

export type Judgement = { score: number; reason: string };

const JUDGE_SYSTEM = `あなたは、面談の振り返りを助ける AI の出力を評価する判定者です。
与えられた観点と基準にだけ沿って、1〜5 の整数で点を付け、理由を一行で書きます。
人物の性質を言い表す言葉（性格、タイプ、癖、傾向）は、理由にも書きません。
出力は JSON だけにします。`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reason"],
  properties: {
    score: { type: "integer", minimum: 1, maximum: 5 },
    reason: { type: "string" },
  },
};

async function judge(label: string, user: string): Promise<Judgement & { meta: CallMeta }> {
  const r = await callStructured<Judgement>({ system: JUDGE_SYSTEM, user, schema: SCHEMA, effort: "medium", model: JUDGE_MODEL, maxTokens: 2000, label });
  return { ...r.data, meta: r.meta };
}

function sceneText(sc: Scene, t: Transcript): string {
  const quotes = sc.quotes.map((q) => `${blockLabel(q.index)}${q.text}`).join("\n");
  const around = sc.quotes
    .flatMap((q) => [q.index - 1, q.index + 1])
    .filter((i) => i >= 0 && i < t.utterances.length)
    .map((i) => `〔${utteranceLabel(i)}・${t.utterances[i].speaker}〕${t.utterances[i].text ?? "（本文なし）"}`)
    .join("\n");
  return `場面の種類：${sc.type}
文脈の一行：${sc.context}
引用（原文と一致を確かめたもの）：
${quotes || "（引用なし）"}
前後の発話：
${around || "（なし）"}
観察：${sc.observation}
直後の相手の反応：${sc.reaction}
読み：${sc.reading}
${sc.asChoice ? `意図した選択として見ると：${sc.asChoice}\n` : ""}問い：${sc.question}`;
}

/** 軸 3：問いの質 */
export async function judgeQuestion(sc: Scene, t: Transcript): Promise<Judgement & { meta: CallMeta }> {
  return judge(
    "軸 3 問いの質",
    `次の「問い」を評価してください。

観点：
- 誘導しない：問いの中に答えや場面の解釈を先に言っていない。
- 開かれている：はい・いいえで終わらず、本人が考えて答える形になっている。
- 引用に即している：引用した発話の、その場面について聞いている（一般論ではない）。
- 一つに絞れている：問いが一つで、二つ以上のことを一度に聞いていない。

基準：
5 = 四つすべてを満たす。
4 = 三つを満たし、残り一つも大きくは外れていない。
3 = 二つを満たす。
2 = 一つだけ満たす。
1 = どれも満たさない（答えを先に言っている、閉じた問い、場面と関係がない）。

${sceneText(sc, t)}`,
  );
}

/** 軸 4：行動の具体性。本人の答えを踏まえているかも見る。 */
export async function judgeAction(c: Candidate, answer: string, sc: Scene): Promise<Judgement & { meta: CallMeta }> {
  return judge(
    "軸 4 行動の具体性",
    `次の「次に試す行動の候補」を評価してください。

観点：
- 次回の面談で観察できる：言葉に表れる行動で、文字起こしを読めば「できた／まだ」が分かる。
- 一つに絞れている：行動が一つで、「〜し、〜し、〜する」のように複数を束ねていない。
- 本人の答えを踏まえている：本人が画面 3 で書いた答えの言葉や向きが、候補に生きている。
- 「もし（場面）なら、（行動）する」の形で、場面が次の面談でも起こりうる形で書かれている（相手の名前や固有の話題に寄っていない）。

基準：
5 = 四つすべてを満たす。
4 = 三つを満たし、残り一つも大きくは外れていない。
3 = 二つを満たす。
2 = 一つだけ満たす。
1 = どれも満たさない（観察できない、複数の行動、本人の答えと無関係）。

次に試せる所の場面：
文脈の一行：${sc.context}
読み：${sc.reading}
問い：${sc.question}

本人の答え：${answer || "（空）"}

候補：
一文：${c.sentence}
セリフの例：${c.lines.map((l) => `「${l}」`).join(" ")}
できたかの基準：${c.criterion}`,
  );
}

/** 軸 10：引用が読みを支えるか */
export async function judgeQuoteSupport(sc: Scene, t: Transcript): Promise<Judgement & { meta: CallMeta }> {
  return judge(
    "軸 10 引用が読みを支えるか",
    `次の場面で、引用（原文と一致したもの）が、「観察」と「読み」を本当に支えているかを評価してください。
引用が原文と一致していることは確かめ済みです。見るのは、引用がその読みの根拠になっているかだけです。

観点：
- 観察が引用から読み取れる：観察に書かれたことが、引用と前後の発話に実際にある。
- 読みが引用に基づく：読みが、引用にある言葉から導けるもので、引用に無いことを足していない。
- 反応が引用の直後の発話に基づく：直後の相手の反応が、前後の発話と合っている。

基準：
5 = 三つすべてを満たし、引用だけで読みが分かる。
4 = 三つを満たすが、読みの一部は引用の外の文脈に頼っている。
3 = 観察は引用に基づくが、読みは引用から離れている。
2 = 引用は場面に関係するが、観察か読みのどちらかが引用と食い違う。
1 = 引用が読みを支えていない（別の場面の引用、引用に無いことを書いている）。

${sceneText(sc, t)}`,
  );
}

/** 軸 12：0c の推測の意味が台本と合うか（「崩れ」の推測だけ。「抜け」は推測の文が無いので回さない） */
export async function judgeGuessMeaning(fragment: string, guess: string, scriptText: string): Promise<Judgement & { meta: CallMeta }> {
  return judge(
    "軸 12 推測の意味",
    `文字起こしで意味が通らなかった断片に対して、AI が付けた推測が、実際に話された言葉（台本）と意味の上で合うかを評価してください。

観点：
- 推測の意味が台本の意味と同じか。言い回しの違いは問わない。
- 推測が、台本に無い意味を足していないか。

基準：
5 = 意味が同じ。
4 = ほぼ同じで、細かい語が違うだけ。
3 = 半分ほど合う。
2 = 向きは合うが中心の語が違う。
1 = 意味が違う、または台本に無い意味を足している。

断片：${fragment}
推測：${guess}
台本（実際に話された言葉）：${scriptText}`,
  );
}
