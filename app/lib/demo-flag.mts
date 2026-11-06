// サンプルの印（Demo Mode のサンプルを通しているか）。
// 記録（Memory）にあるのはサンプルの講師の記録なので、前の面談の言葉を添えてよいのは、サンプルを通しているときだけ。
// 訪れた人が貼った面談に添えると、別の人の発言が「あなたの言葉」になってしまう。

/** 入力を変えた後も印を残すか。貼る欄の文を書き換えたら外す。場面の種類・呼び名・発言の直しでは外さない */
export function demoAfterInput(demo: boolean, patch: { raw?: string }): boolean {
  return patch.raw !== undefined ? false : demo;
}

/** 画面 4 が POST /api/candidates に送る中身。印があるときだけ demo: true を足す（無いときは欄ごと送らない） */
export function candidatesBody<T, S>(p: { transcript: T; scene: S; answer: string; demo: boolean }): { transcript: T; scene: S; answer: string; demo?: true } {
  const body = { transcript: p.transcript, scene: p.scene, answer: p.answer };
  return p.demo === true ? { ...body, demo: true } : body;
}
