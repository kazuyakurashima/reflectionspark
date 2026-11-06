// 待つ間に画面へ届ける進み具合。届けるのは、実際に起きたことだけ（いまどの工程か、途中の出力から数えられる量）。
// 時間から作った見かけの数字は入れない。数えられない工程は、工程の名前だけを届ける。
// ここは数えるだけで、API は呼ばない（テストで守る）。

/** stage は工程の名前（"0a"・"0b"・"1"・"2"）。done／total は数えられるときだけ。unit は数の単位 */
export type ProgressEvent = { stage: string; done?: number; total?: number; unit?: string };
export type OnProgress = (e: ProgressEvent) => void;

/** 空白を除いた字数 */
export function countChars(s: string): number {
  return [...s.replace(/\s/g, "")].length;
}

/** JSON の文字列の中身（閉じる前のものも）から、完成した文字だけを数える（空白を除く）。途中で切れたエスケープは、まだ数えない */
function countJsonChars(body: string): number {
  let n = 0;
  for (const m of body.matchAll(/\\u([0-9a-fA-F]{4})|\\u[0-9a-fA-F]{0,3}$|\\([\s\S])|([^\\])/gu)) {
    if (m[1] !== undefined) {
      const code = parseInt(m[1], 16);
      // サロゲートは 2 つで 1 字。後ろの半分で数える
      if (code >= 0xd800 && code <= 0xdbff) continue;
      if (!/\s/.test(String.fromCharCode(code))) n += 1;
    } else if (m[2] !== undefined) {
      if (!"nrtf".includes(m[2])) n += 1;
    } else if (m[3] !== undefined && !/\s/.test(m[3])) {
      n += 1;
    }
  }
  return n;
}

/**
 * 工程 0a（copy）の途中の出力から、写し終えた本文の字数を数える（空白を除く）。
 * 出力は JSON の途中までなので、"text" の値を、閉じていないものも含めて拾う。
 */
export function copiedChars(partialJson: string): number {
  let n = 0;
  for (const m of partialJson.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/g)) n += countJsonChars(m[1]);
  return n;
}

/**
 * 空白を除いて n 字まで写し終えたとき、元の文（空白を含む）の何字目まで来たかを返す。
 * 画面の入力欄の字数（空白を含む）と、同じ数え方で並べるため。
 */
export function rawPositions(raw: string): { total: number; at: (nonSpace: number) => number } {
  const chars = [...raw];
  const ends: number[] = [];
  chars.forEach((c, i) => {
    if (!/\s/.test(c)) ends.push(i + 1);
  });
  return { total: chars.length, at: (n) => (n <= 0 ? 0 : n >= ends.length ? chars.length : ends[n - 1]) };
}

/** 途中の出力（JSON）に、あるキーが何回出たか */
export function countKey(partialJson: string, key: string): number {
  return [...partialJson.matchAll(new RegExp(`"${key}"\\s*:`, "g"))].length;
}

/** 工程 0a（label）の途中の出力から、話者を付け終えた文の数を数える（reasons・splits の n は数えない） */
export function labeledSentences(partialJson: string): number {
  const end = partialJson.search(/"reasons"\s*:/);
  return countKey(end === -1 ? partialJson : partialJson.slice(0, end), "n");
}

/**
 * 工程 1 の途中の本文から、いま書いている所を返す。
 * 0：まだ本文が無い（読んでいる）／1・2：その番号の場面を書いている／3：場面の後（まとめと流れ）を書いている
 */
export function step1Phase(partialText: string): number {
  if (/<(summary|flow|extra_question)\b/.test(partialText)) return 3;
  const scenes = [...partialText.matchAll(/<scene\b/g)].length;
  if (scenes > 0) return Math.min(scenes, 2);
  return /<no_scene\b/.test(partialText) ? 3 : 0;
}

/** 工程 2 の途中の出力から、点を付け終えた項目の数を数える（書き始めた項目の一つ前まで。ethics が出たら全部） */
export function scoredItems(partialJson: string, total = 5): number {
  if (/"(insight_owner|ethics)"\s*:/.test(partialJson)) return total;
  return Math.min(total, Math.max(0, countKey(partialJson, "item") - 1));
}

/** 同じ中身を続けて届けない。量は、前に届けた時から step 以上進んだときだけ届ける */
export function throttled(send: OnProgress, step = 1): OnProgress {
  let last: ProgressEvent | null = null;
  return (e) => {
    if (last && last.stage === e.stage && last.total === e.total) {
      const moved = (e.done ?? 0) - (last.done ?? 0);
      const finished = e.total !== undefined && e.done === e.total && moved > 0;
      if (moved < step && !finished) return;
    }
    last = e;
    send(e);
  };
}
