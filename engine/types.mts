// エンジンの型。工程 0〜4 が受け取るもの・返すものを、docs/設計書.md「画面ごとに AI が受け取るものと返すもの」に沿って書く。

export type MeetingKind = "生徒" | "保護者" | "コーチング";

/** 話者ラベル。self が本人（面談する側）、other が相手。 */
export const SPEAKER_LABELS: Record<MeetingKind, { self: string; other: string }> = {
  生徒: { self: "講師", other: "生徒" },
  保護者: { self: "講師", other: "保護者" },
  コーチング: { self: "コーチ", other: "クライアント" },
};

export type Confidence = "高" | "中" | "低";

/** 工程 0 の後の発話。text は 0b の直しを当てた後、original は元の文字起こしの文。 */
export type Utterance = {
  /** 発話番号（0 始まり。並びの位置と同じ）。以後の工程・AI に渡す札・画面で同じ番号を使う（engine/utterance-no.mts） */
  index: number;
  speaker: string;
  /** 直しを当てた後の本文。当て直せないときは null（本文を出さず番号だけ） */
  text: string | null;
  /** 元の文字起こしの文（手を加えない） */
  original: string;
  confidence: Confidence;
  confidenceReason?: string;
  /** 画面 1 で本人が確かめる印（確からしさが低い、0b で直した、相手が 2 人以上と推定、元の文に当て直せなかった） */
  check: string[];
  /** 元の文字起こし（1 本の文）での位置 [start, end)（コードポイント単位）。当て直せないときは null */
  memoSpan: [number, number] | null;
};

export type CorrectionKind =
  | "同音の取り違え"
  | "近い音の聞き違え"
  | "崩れた語"
  | "数字や英字の表記"
  | "語の区切り"
  | "助詞や語尾の聞き違え"
  | "欠けた音"
  | "直前の発言の繰り返しの取り違え"
  | string;

export type Correction = {
  index: number;
  kind: CorrectionKind;
  before: string;
  after: string;
};

export type DiscardedCorrection = Correction & { reason: string };

/** 0a の作り方。copy：モデルに本文を写させ、元の文に当て直す（今の作り方）。label：アプリが文に切って番号を付け、モデルは番号ごとの話者だけを返す（速い作り方） */
export type Step0aMode = "copy" | "label";

export type Step0aRaw = {
  utterances: { speaker: string; text: string; confidence: Confidence; reason?: string }[];
  /** 相手が 2 人以上と推定したか */
  multipleOthers: boolean;
  /** 相手が 2 人以上のとき、その理由 */
  multipleOthersReason?: string;
};

/** 0a（label）のモデルの返事。本文は無く、番号ごとの話者と確からしさ、低いときの理由、一文の中で話者が替わる所。 */
export type Step0aLabelRaw = {
  sentences: { n: number; speaker: string; confidence: Confidence }[];
  reasons: { n: number; reason: string }[];
  /** 一文の中で話者が替わる所。at は後の話者の言葉の始まり（その文にある文字列そのまま） */
  splits: { n: number; at: string; speaker: string; confidence: Confidence; reason: string }[];
  multipleOthers: boolean;
  multipleOthersReason?: string;
};

export type Step0bResult = {
  /** モデルが返した直しの一覧（そのまま） */
  proposed: Correction[];
  /** 当てた直し */
  applied: Correction[];
  /** 捨てた直しと理由 */
  discarded: DiscardedCorrection[];
  /** 返事が読めなかったとき、その理由（直さずに先へ進む） */
  failed?: string;
};

export type Guess = {
  index: number;
  kind: "崩れ" | "話者の取り違え";
  /** 元の文の中の、意味が通らない所 */
  fragment: string;
  /** 推測（意味を優先） */
  guess: string;
  /** 手がかり */
  clue: string;
};

export type Step0cResult = {
  /** 先に書いた会話全体の要旨（2〜3 文） */
  summary: string;
  guesses: Guess[];
  failed?: string;
  /** 性質の言葉が入っていて表示を控えた欄（engine/guard.mts） */
  withheld?: { field: string; words: string[]; original: string }[];
};

/** 工程 0 の結果。正本は「元の文と直しの一覧」。 */
export type Transcript = {
  kind: MeetingKind;
  /** 貼った文字起こし（そのまま） */
  raw: string;
  utterances: Utterance[];
  multipleOthers: boolean;
  step0b: Step0bResult;
  /** 0c は分析と同時に別に送るので、無いこともある */
  step0c: Step0cResult | null;
  /** 0a の作り方（記録用。古い結果には無い） */
  step0aMode?: Step0aMode;
};

/** 呼び出しの使用量と時間 */
export type CallMeta = {
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type Quote = {
  /** citations の cited_text（そのまま。document のブロックは「話者：本文」の形なので、話者が付いている） */
  citedText: string;
  /** 画面に出す引用の本文。cited_text から話者の前置きを外したもので、発話の本文（text）と完全一致したものだけ verified になる */
  text: string;
  /** 発話番号（start_block_index） */
  index: number;
  /** end_block_index（含まない） */
  endIndex: number;
  /** 原文（整形後の発話）と完全一致したか。一致しない引用は画面に出さない（決まり 1） */
  verified: boolean;
};

export type SceneType = "よく表れた所" | "次に試せる所";

export type Scene = {
  type: SceneType;
  /** 関わる採点表の項目（あれば） */
  items: number[];
  /** 文脈の一行（事実だけ） */
  context: string;
  /** 検証した引用だけ。空なら、引用を出せなかった場面 */
  quotes: Quote[];
  /** 検証で捨てた引用（記録用） */
  discardedQuotes: Quote[];
  /** モデルが本文に書いた引用文（検証していないので画面に出さない。記録用） */
  quotedTextInBody: string;
  observation: string;
  reaction: string;
  reading: string;
  /**
   * 読みの要の一句（画面で目立たせる。11/8）。読みの文にそのまま入っているときだけ持つ（入っていなければ null）。
   * 前の作りの出力には無い
   */
  readingKey?: string | null;
  /** 次に試せる所だけ */
  asChoice: string | null;
  question: string;
  /**
   * 読み・観察・直後の相手の反応が指す発話の番号（範囲は広げたもの）。文の中には番号を書かせず、ここに分けて返させる（一読で分かるように。11/8）。
   * 前の作りの出力には無く、文の中に「発話 n」が書いてある
   */
  refs?: { reading: number[]; observation: number[]; reaction: number[] };
  /** 画面に出さない記録 */
  record: { whyChosen: string; runnerUp: number[] };
};

export type Step1Result = {
  scenes: Scene[];
  /** 根拠のある場面が無いとき、その説明 */
  noScene: string | null;
  summary: string;
  flow: string[];
  /** 事情を尋ねる問い。11/8 に画面から外し、AI にも書かせない。前の作りの出力にだけある */
  extraQuestion: string | null;
  /** 引用の数：生成した・原文と合わず捨てた・引用を出せなかった場面 */
  quoteStats: { generated: number; discarded: number; scenesWithoutQuote: number };
  /** 最初の引用（citations_delta）が届くまでの時間 */
  firstCitationMs: number | null;
  rawText: string;
  meta: CallMeta;
  /** 性質の言葉が入っていて表示を控えた欄と、原文に無くて「」を外した言葉（engine/guard.mts） */
  withheld: { field: string; words: string[]; original: string }[];
  unverifiedQuotes: { field: string; text: string }[];
  /** 文の中の「発話 n」の数と、発話の並びの範囲に無い番号（engine/utterance-no.mts。記録と評価のため。古い結果には無い） */
  utteranceRefs?: { total: number; outOfRange: number[] };
};

export type ItemNumber = 1 | 2 | 3 | 4 | 5;

export type ItemScore = {
  item: ItemNumber;
  /** 点。「この面談では判定しない」は null */
  score: number | null;
  /** 一読で分かる説明（発話番号を書かない。画面で先に見せる）。工程 2 だけが書く。古い結果と工程 4 には無い */
  plain?: string;
  /** 根拠を発話番号で指した説明（画面では「根拠を見る」で開く） */
  reason: string;
  utterances: number[];
};

export type EthicsLevel = "問題なし" | "判断できない" | "確かめてください" | "所属の手順";

export type Step2Result = {
  items: ItemScore[];
  /** アプリが計算する合計（engine/rubric.mts） */
  total: { sum: number; judgedCount: number; max: number; scaled: number | null };
  insightOwner: "講師" | "相手" | "両方";
  ethics: { level: EthicsLevel; text: string; viewpoint: string | null; utterances: number[] };
  meta: CallMeta;
  withheld: { field: string; words: string[]; original: string }[];
  unverifiedQuotes: { field: string; text: string }[];
};

/** 画面 3：候補に添える、前の面談での本人の言葉。すべて記録（メモリ）の原文から引く。AI が書いた文は入らない（決まり 1） */
export type PreviousWords = {
  /** 面談の日付（YYYY-MM-DD） */
  date: string;
  /** 相手の札 */
  otherTag: string | null;
  /** 直前の発話（記録に無ければ null） */
  before: { index: number; speaker: string; text: string } | null;
  /** 本人の発言 */
  own: { index: number; speaker: string; text: string };
  /** 直後の発話（記録に無ければ null） */
  after: { index: number; speaker: string; text: string } | null;
  interviewId: string;
  /** 発話番号 */
  utterance: number;
};

/** 前の面談の場面について、その回に AI が書いた文（記録の「AI が書いた説明」と「その回の AI の読み」の欄）。原文と照合していない */
export type RecordSceneText = { context: string | null; observation: string | null; reaction: string | null; reading: string | null; asChoice: string | null };

/**
 * 画面 3「この場面、前にもありました」：今回の「次に試せる所」と同じ形の、前の面談の場面。
 * 発話はすべて記録（メモリ）の原文から引く（決まり 1）。見出し・夢のまとめ・その回の AI の文は、解釈・仮説として分けて出す（11/8 に本人が決めた）。
 */
export type RepeatScene = PreviousWords & {
  kind: MeetingKind;
  /** 工程 3 が書いた、そのやりとりの形の 1 行（場面と本人の行動）。言葉の検査で外したら null */
  title: string | null;
  /** 夢のまとめ：その発話を根拠に挙げた、夢の仮説の文。無ければ null */
  summary: string | null;
  /** その発話を含む場面の種類と、その回に AI が書いた文。場面でなく前回の行動の欄にある発話なら null */
  scene: ({ type: SceneType } & RecordSceneText) | null;
  /** 会話を確認する：その発話を含む、記録にあるひと続きの発話（原文） */
  lines: { index: number; speaker: string; text: string }[];
};

export type Candidate = {
  /** もし（場面）なら */
  condition: string;
  /** （行動）する */
  action: string;
  /** 一文の形「もし〜なら、〜する」 */
  sentence: string;
  /** セリフの例 2〜3 */
  lines: string[];
  /** できたかの基準（次の面談で何が言葉に表れたら「できた」か） */
  criterion: string;
  /** どこから作ったか（本人の答えのどの言葉から。答えが空なら場面と読みから）。持ち帰る一文には入れない */
  basis?: string;
  /** 工程 3 が返した、前の面談の発話の札。engine/memory-read.mts で原文を引いたら消す */
  previousRef?: string;
  /** 前の面談での本人の言葉（記録に合うものがあるときだけ。候補ごとに 0 か 1 つ） */
  previous?: PreviousWords;
};

export type Step3Result = {
  candidates: Candidate[];
  /** 今回の「次に試せる所」と同じ形の、前の面談の場面（記録に合うものがあるときだけ。2 つまで、古い順） */
  repeats?: RepeatScene[];
  /** 言葉に表れない行動として落とした候補 */
  dropped: { candidate: Candidate; reason: string }[];
  meta: CallMeta;
  withheld: { field: string; words: string[]; original: string }[];
  unverifiedQuotes: { field: string; text: string }[];
};

export type FollowUpVerdict = "できた" | "一部" | "まだ" | "場面がなかった";

export type Step4Result = {
  verdict: FollowUpVerdict;
  quotes: Quote[];
  discardedQuotes: Quote[];
  why: string;
  items: ItemScore[];
  total: Step2Result["total"];
  /** （あれば）相手が前回決めたことが今回どう語られたかの 1 行 */
  otherPersonLine: string | null;
  quoteStats: { generated: number; discarded: number };
  firstCitationMs: number | null;
  rawText: string;
  meta: CallMeta;
  withheld: { field: string; words: string[]; original: string }[];
  unverifiedQuotes: { field: string; text: string }[];
  /** 文の中の「発話 n」の数と、発話の並びの範囲に無い番号（古い結果には無い） */
  utteranceRefs?: { total: number; outOfRange: number[] };
};

/** 前回の Spark（画面 3 で本人が選んだ一つ） */
export type Spark = {
  sentence: string;
  criterion: string | null;
  /** 前回の「次に試せる所」の場面（ふつうの文として渡す） */
  previousScene: { context: string; quoteText: string | null; reading: string } | null;
};
