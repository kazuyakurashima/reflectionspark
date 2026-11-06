// ReflectionSpark の印。面談の地図と同じ 4 本の棒（上が本人、下が相手）で、1 本だけが琥珀色。
// 「面談の中から、次に試すひとつを選ぶ」ことを表す。同じ形を app/icon.svg（ブラウザのタブの印）にも置く。

export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="4" y="9" width="5" height="8" rx="2.5" fill="#27505a" />
      <rect x="10.5" y="15" width="5" height="9" rx="2.5" fill="#b9ab93" />
      <rect x="17" y="4" width="5" height="13" rx="2.5" fill="#f59e0b" />
      <rect x="23.5" y="15" width="5" height="6" rx="2.5" fill="#b9ab93" />
    </svg>
  );
}
