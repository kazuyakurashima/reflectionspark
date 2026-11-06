"use client";

// 見た目の比べ（仮）。「四角で囲む」と「囲まない」を切り替えて、全画面を見比べるためのもの。
// 選んだ方はこのブラウザに覚える。本人がどちらにするか決めたら、この部品ごと消す（app/globals.css の同じ印の所も）。

import { useEffect, useSyncExternalStore } from "react";

import { segItem } from "./ui";

const LOOK_KEY = "reflectionspark:look";
type Look = "card" | "open";
const LOOKS: { value: Look; label: string }[] = [
  { value: "card", label: "四角で囲む" },
  { value: "open", label: "囲まない" },
];

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const read = (): Look => (document.documentElement.dataset.look === "open" ? "open" : "card");

function setLook(v: Look) {
  document.documentElement.setAttribute("data-look", v);
  try {
    window.localStorage.setItem(LOOK_KEY, v);
  } catch {
    // 覚えられなくても切り替える
  }
  listeners.forEach((l) => l());
}

export function LookSwitch() {
  const look = useSyncExternalStore(subscribe, read, () => "card" as Look);
  // 覚えてある方を、開いたときに当てる（印は html に付ける。無ければ「四角で囲む」）
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LOOK_KEY) === "open") setLook("open");
    } catch {
      // 読めなければ「四角で囲む」のまま
    }
  }, []);
  return (
    <div className="flex items-center gap-2 text-xs text-ink-3">
      <span id="look-label">見た目の比べ（仮）</span>
      <span className="inline-flex gap-1 rounded-md border border-line-2 bg-white p-0.5" role="group" aria-labelledby="look-label">
        {LOOKS.map((l) => (
          <button key={l.value} type="button" onClick={() => setLook(l.value)} aria-pressed={look === l.value} className={segItem(look === l.value, true)}>
            {l.label}
          </button>
        ))}
      </span>
    </div>
  );
}
