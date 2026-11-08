// 前の画面 3「問いに答える」。11/8 に、問いへの答えは画面 2（読む）の中で書く形にした（app/reflection/page.tsx）。
// 古いリンクやブックマークから来たときは、読む画面へ送る。
import { redirect } from "next/navigation";

export default function Answers() {
  redirect("/reflection");
}
