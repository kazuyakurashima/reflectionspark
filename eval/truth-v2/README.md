# 正解 v2（山場の 2 本だけ）

- **何か**：`student-shinro` と `student-shinro-2` の正解 v1 に、作り手が自分の判定と別の判定（Codex）を突き合わせて決めた直しを当てたもの。`eval/truth/` の v1 は残す。
- **読み方**：v1 と v2 の数字は比べない（CLAUDE.md「版をまたいで数字を比べない」）。v2 の表は別に出す。
- **作り手の判定だけでできた版ではない。** 突き合わせには Codex の判定を、見直しには ChatGPT も使った。決めたのは作り手。
- **軸 9（点の向き）は、この 2 本では数えられなくなる。** 軸 9 は ○ の項目と × の項目の組で見て、○× は数えない。v2 では `student-shinro` に ○ が、`student-shinro-2` に × が無い。

## v1 からの直し

| ケース | 項目 | v1 | v2 |
|---|---|---|---|
| student-shinro | 1 | ○ よく 21、45、47 | ○× まずく 100〜103 を足す |
| student-shinro | 2 | × まずく〔案〕100〜102 | ○× よく 52〜60 を足す。まずくは〔案〕のまま |
| student-shinro | 3 | × まずく〔案〕61、101、139〜141 | × まずく〔決め〕60〜62、100〜102、139〜142 |
| student-shinro-2 | 1 | ○× よく 5〜15 | ○× よく 5〜15、35〜40、49〜54 |
| student-shinro-2 | 3 | ○ よく 63、66、68 | ○ よく 63〜68、69〜83 |
| student-shinro-2 | 4 | × 範囲なし | ○ よく 63〜76 |

採らなかった案は v1 のまま（`student-shinro` の項目 4 の「よく」、`student-shinro-2` の項目 1 の「まずく」22〜24、項目 2 の「よく」40〜45、項目 5 の「よく」40〜42）。

## 回し方

AI の出力は `eval/results/runs` のものをそのまま使い、LLM は呼ばない。

```
node eval/scripts/report.mts --truth eval/truth-v2 --out eval/results/runs-v2 --keep-judge --e2e none
```
