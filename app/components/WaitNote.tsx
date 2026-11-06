// AI を待つ間に出す一行。かかる時間の目安、タブを開いたままにすること、閉じたときの戻り方を伝える。
// 処理はこのタブの中で待つ作りなので、タブを閉じると結果は届かない（裏で続ける作りは、まだ無い）。

export function WaitNote({ time, reopen }: { time: string; reopen: string }) {
  return (
    <p className="mt-1 text-xs text-stone-500" aria-live="polite">
      {time}かかります（長い面談ではもっとかかります）。このタブは開いたままにしてください。待つ間、ほかの作業をしていてかまいません。タブを閉じたときは、{reopen}
    </p>
  );
}
