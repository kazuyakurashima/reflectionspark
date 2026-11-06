// 遅れて届いた応答を、別の入力のセッションに保存しないための照合。
// 応答を待つ間に、サンプルを選ぶ・貼り直す・発言を直すと、セッションの中身は変わる。古い応答をそのまま保存すると、
// 貼った面談にサンプルの印やサンプルの講師の言葉が移る。頼んだ時の入力と今の入力が同じときだけ保存する。

export type InputStamp = { id: string; raw: string; kind: string };

/** 整形を頼んだ時と、同じセッションの同じ入力か */
export function sameInput(stamp: InputStamp, s: InputStamp): boolean {
  return s.id === stamp.id && s.raw === stamp.raw && s.kind === stamp.kind;
}

type Lines = { raw: string; utterances: { speaker: string; text: string | null }[] };

/** 同じ文字起こしの、同じ発言の並びか（話者と本文）。0c の推測の有無は問わない */
export function sameTranscript(a: Lines | null | undefined, b: Lines | null | undefined): boolean {
  if (!a || !b || a.raw !== b.raw || a.utterances.length !== b.utterances.length) return false;
  return a.utterances.every((u, i) => u.speaker === b.utterances[i].speaker && u.text === b.utterances[i].text);
}
