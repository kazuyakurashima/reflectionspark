"use client";

// 場面の原文のやりとり。引用した発話と、その直前・直後の発話を「島」（app/components/UtteranceView.tsx）で並べる。
// 行の役目は文字でも書く（引用・見立てが触れた発言・直前・直後）。直前と直後の発話はアプリが発話番号から取る（決まり 1）。

import type { Transcript } from "@/engine/types.mts";
import type { SceneSpan } from "@/app/lib/scene-view.mts";
import { Island } from "./UtteranceView";

export function SceneLines({
  t,
  span,
  from,
  to,
  pointed = [],
  pointedTag = "見立てが触れた発言",
}: {
  t: Transcript;
  span: SceneSpan;
  /** 並べる最初と最後の発話番号（含む） */
  from: number;
  to: number;
  /** AI の見立てや事実が触れた発話（引用でないもの）。「見立てが触れた発言」の印を付ける */
  pointed?: number[];
  /** pointed の行に付ける印の言葉 */
  pointedTag?: string;
}) {
  const quoted = new Set(span.quoted);
  const touched = new Set(pointed);
  const tagOf = (i: number) => {
    if (i === span.focal) return quoted.size > 1 ? "引用（AI が最初に挙げた発言）" : "引用";
    if (quoted.has(i)) return "引用";
    if (touched.has(i)) return pointedTag;
    if (i === span.from - 1) return "直前";
    if (i === span.to + 1) return "直後";
    return undefined;
  };
  return (
    <ol className="space-y-3.5 px-3 py-5 sm:px-5">
      {t.utterances.slice(from, to + 1).map((u) => (
        <li key={u.index}>
          <Island t={t} u={u} role={u.index === span.focal ? "focal" : quoted.has(u.index) ? "quoted" : touched.has(u.index) || u.index === span.from - 1 || u.index === span.to + 1 ? "plain" : "context"} tag={tagOf(u.index)} />
        </li>
      ))}
    </ol>
  );
}
