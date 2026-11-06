// 画面 1〜5 で共通の見た目（クラスの並び）。ボタン・カード・入力欄の形と色をここで一つに決め、画面ごとに作り直さない。
// - ボタンは角の小さい四角。主のボタン（次へ進む）は差し色の塗り、副のボタンは差し色の枠。小さいボタンも同じ形で高さだけ変える。
// - 丸は、番号の印（進み具合・場面の番号）だけに使う。
// - 琥珀色は「次に試すひとつ（Spark）」だけ（app/globals.css の色の決まり）。

export const PAGE = "mx-auto max-w-3xl px-4 pb-12 text-base leading-[1.85] md:text-[1.0625rem]";
export const CARD = "rs-card rounded-lg border border-line bg-surface px-5 py-6 shadow-[0_1px_2px_rgba(29,27,24,0.05)] sm:px-8 sm:py-8";
export const H1 = "text-[1.6rem] font-semibold leading-snug";
export const H2 = "text-[1.15rem] font-semibold leading-snug";
export const LEAD = "mt-2 text-[0.95rem] leading-[1.8] text-ink-2";
export const LABEL = "block text-[0.86rem] font-semibold text-ink-2";

const BTN = "inline-flex shrink-0 items-center justify-center rounded-md font-semibold transition-colors disabled:cursor-not-allowed";
export const BTN_PRIMARY = `${BTN} min-h-12 bg-accent px-6 text-white hover:bg-accent/90 disabled:bg-line disabled:text-ink-3`;
export const BTN_SECONDARY = `${BTN} min-h-12 border border-accent bg-surface px-6 text-accent hover:bg-accent-soft disabled:border-line-2 disabled:text-ink-3 disabled:hover:bg-surface`;
export const BTN_SMALL_PRIMARY = `${BTN} min-h-10 bg-accent px-4 text-[0.92rem] text-white hover:bg-accent/90 disabled:bg-line disabled:text-ink-3`;
export const BTN_SMALL = `${BTN} min-h-10 border border-line-2 bg-surface px-4 text-[0.92rem] text-ink hover:border-ink-2 disabled:text-ink-3 disabled:hover:border-line-2`;

export const LINK = "text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent";
export const QUIET_LINK = "text-ink-3 underline decoration-ink-3/40 underline-offset-[3px] hover:text-ink";

export const FIELD = "rounded-md border border-line-2 bg-white px-3.5 py-2.5 text-[0.98rem] leading-[1.8] placeholder:text-ink-3 focus:border-accent focus:outline-none";
/** 仮の出力・失敗・補足などの、控えめな知らせ */
export const NOTE = "rounded-md border border-line-2 bg-paper px-4 py-3 text-[0.92rem] leading-[1.7]";

/** いくつかから一つを選ぶ並び（場面の種類、話者、判定） */
export const SEG = "inline-flex flex-wrap gap-1 rounded-md border border-line-2 bg-white p-1";
export const segItem = (on: boolean, small = false) =>
  `rounded-[4px] ${small ? "min-h-8 px-3 text-[0.86rem]" : "min-h-10 px-4 text-[0.92rem]"} ${on ? "bg-accent font-semibold text-white" : "text-ink-2 hover:bg-accent-soft hover:text-ink"}`;

/** カードの中の、少し下がった地（場面の文脈など） */
export const INSET = "rs-inset rounded-md px-5 py-4";

/** 次に試すひとつ（Spark）の地 */
export const SPARK_BOX = "rounded-md border border-amber-300 bg-amber-50 px-5 py-4";
