// 発言の説明の幅と位置。番号の左端にそろえ、画面の端に余白を残して収める。

const WIDTH = 320;
const MARGIN = 16;

/** anchorLeft は番号の左端（画面の左から）。返すのは説明の幅と、番号の左端からのずらし */
export function tooltipPlace(anchorLeft: number, viewportWidth: number): { width: number; shift: number } {
  const width = Math.min(WIDTH, Math.max(0, viewportWidth - MARGIN * 2));
  const left = Math.min(Math.max(anchorLeft, MARGIN), viewportWidth - MARGIN - width);
  return { width, shift: Math.round(left - anchorLeft) };
}
