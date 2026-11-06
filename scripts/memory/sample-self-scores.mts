// サンプルの講師の過去 4 回の、自己採点と一言と自己評価（作ったダミー）。AI には渡さない。点の控え（②）にだけ入れる（決まり 10）。
// 台本の仕込み（eval/cases/<面談>/notes.md）に合わせて作った案。AI の点との差が縮んでいく並びにしない（少ない回数で成長したと言わない）。
// confirmed が false の間は、ストアに書かない（本人が確かめてから true にする）。

import type { SelfEntry } from "../../engine/score-ledger.mts";

export const SAMPLE_SELF_CONFIRMED = true;

export const SAMPLE_SELF: Record<string, SelfEntry> = {
  "student-seiseki": { selfScore: 6, selfNote: "「嫌いになりそう」の話は聞けた。最後の決め方は、こちらで急いだかも。", selfVerdict: null },
  "student-yaruki": { selfScore: 7, selfNote: "ゲームの話で、初めてたくさん話してくれた。後半は自分が話しすぎた。", selfVerdict: null },
  "student-yaruki-2": { selfScore: 6, selfNote: "黙ったら待つつもりでいた。待てた気もするが、気づくと話していた回もあった。", selfVerdict: "一部" },
  "student-seiseki-2": { selfScore: 5, selfNote: "数学は聞き返せた。英語は流してしまった。", selfVerdict: "一部" },
};
