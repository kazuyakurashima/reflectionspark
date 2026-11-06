// 記録係と夢の呼び出し（docs/設計書.md 工程 5・6 と「覚えていると整理」）。サーバー側からだけ使う。
// - 記録係：Managed Agents のセッションに、engine/memory-record.mts で作った記録の文を渡し、メモリストアに 1 回 1 ファイルで書かせる。
//   書いたあと、アプリがメモリストアから読み返し、渡した文と同じか、性質の言葉と名前が無いかを確かめる。
// - 夢：メモリストアと記録係のセッションを渡して整理させる。出力の形は instructions で決める。
//   夢には費用の上限が無いので、使用量を見張り、上限（入力トークン換算）を超えたら取り消す。
// 渡さないもの：本人の自己採点・自己評価、文字起こしの全文（記録の文に入っていない）。
// 金額はリポジトリに書かない。上限は呼ぶ側が渡す。

import type Anthropic from "@anthropic-ai/sdk";

import { checkMarkdown, INDEX_PATH, recordPath } from "./memory-record.mts";
import type { RecordCheck } from "./memory-record.mts";

/** 記録係のモデル。渡された文をそのまま書く仕事なので、分析のモデルより軽いものにする */
export const RECORDER_MODEL = process.env.REFLECTIONSPARK_RECORDER_MODEL ?? "claude-sonnet-5-5";
/** 夢のモデル。Sonnet 5.5 で始める（設計書「覚えていると整理」） */
export const DREAM_MODEL = process.env.REFLECTIONSPARK_DREAM_MODEL ?? "claude-sonnet-5-5";

export const INDEX_HEADING = "# 索引（面談の記録）";

/** 記録係のエージェントへの指示 */
export function recorderSystem(): string {
  return `あなたは「記録係」です。面談の振り返りの記録を、メモリストアに書き留めます。

仕事は 2 つだけです。
1. 渡された「記録の本文」を、指定された記録のファイルに、一字も変えずに書く。
2. 索引のファイルのいちばん下に、渡された「索引の 1 行」を足す。索引のファイルが無ければ、渡された見出しを 1 行目にして作る。

守ること
- 記録の本文を書き換えない。要約しない。並べ替えない。言い回しを直さない。「>」で始まる行は発話の原文なので、句読点も空白もそのままにする。
- 自分の考え、感想、評価、まとめを足さない。人物の性質を言い表す言葉を書かない。
- 指定された 2 つのファイルのほかは、作らない・書き換えない・消さない。
- 同じ名前の記録のファイルがすでにあれば、上書きせず、そのことを報告して止まる。
- メモリストアは /mnt/memory/ の下に載っている。場所を決め打ちせず、最初に確かめる。
- 書いたあとにファイルを読み返し、渡された本文と同じかを確かめる。違っていれば書き直す。
- 終わったら、書いたファイルの場所と、索引に足した行だけを短く報告する。`;
}

/** メモリストアをセッションに載せるときの説明（4,096 字まで） */
export function storeInstructions(): string {
  return `面談する側ひとりの、面談の振り返りの記録。records/ に 1 回の面談につき 1 ファイル、index.md が索引（1 回につき 1 行）。記録係は、渡された文をそのまま書き、索引に 1 行足す。ほかのファイルには触らない。`;
}

/** 記録係に送る文。記録の本文は <record> の間にそのまま入れる */
export function recorderMessage(interviewId: string, markdown: string, indexLineText: string): string {
  return `次の面談の記録を書き留めてください。

- 記録のファイル：メモリストアの ${recordPath(interviewId).slice(1)}
- 索引のファイル：メモリストアの ${INDEX_PATH.slice(1)}

索引の 1 行（<index_line> の間。タグは書かない）：
<index_line>
${indexLineText}
</index_line>

索引のファイルが無いときの見出し：${INDEX_HEADING}

記録の本文（<record> の間。タグは書かない。一字も変えない）：
<record>
${markdown.trimEnd()}
</record>`;
}

/** 夢が書くファイルの名前（アプリはこの名前で読む） */
export const DREAM_FILES = {
  index: "/index.md",
  recurring: "/recurring-scenes.md",
  changes: "/changes.md",
  actions: "/actions.md",
} as const;

/**
 * 夢への指示（1〜4,096 字）。出力の形と、決まり 3・12 をここで決める。
 * 根拠の書き方（〔面談ID｜発話 n〕話者：「引用」）は engine/memory-evidence.mts が読む形。
 */
export function dreamInstructions(interviewCount: number): string {
  const text = `これは、面談する側（講師）ひとりの、面談の振り返りの記録です。records/ に 1 回の面談につき 1 ファイルあります（${interviewCount} 回分）。検証用の暫定の記録で、本人はまだ確かめていません。

あなたの仕事：記録を読み、回をまたいで繰り返し現れる場面と行動、前後の違いを、根拠つきの「条件付きの行動仮説」として整理し、下の 4 つのファイルに書く。

守ること
1. 人ではなく、場面と行動を書く。人物の性質を言い表す言葉（「〜な人」「〜する人」「癖」「性格」「タイプ」「傾向」「〜しがち」「性質」「人柄」など）、優劣、「〜すべき」を使わない。
   ×「説明しすぎる人」 ○「${interviewCount} 回のうち 3 回で、相手が自分の状況を話した直後に、説明へ進む場面があった」
2. 仮説は「〈どんな場面〉で、〈どんな行動〉があった」の形にし、回数を限る（「この ${interviewCount} 回のうち n 回で」）。
3. 仮説ごとに、根拠、例外・反例、確からしさを書く。
   - 根拠：面談 ID と発話番号と引用。2 回以上の面談から挙げる。1 回の面談にしか無いものは、確からしさを「保留」にする。
   - 例外・反例：同じ形の場面で、違う行動があった所を記録から探して挙げる。無ければ「この記録の範囲には見当たらない」と書く。反例があれば言い切らない。
   - 確からしさ：高・中・低・保留のどれか。迷えば保留。
4. 引用は、記録の「>」で始まる行（発話の本文）から、一字も変えずに写す。縮めない。言い換えない。発話番号は行の札〔発話 n〕の番号をそのまま使い、自分で数えない。記録に無い発話を根拠にしない。
5. 根拠は 1 行に 1 つ、次の形で書く（この形の行を、アプリが原文と照合する）。説明は別の行に書く。
   - 〔面談ID｜発話 n〕話者：「引用」
6. 記録の「その回の AI の読み（仮説）」は、その回だけの読みで、事実ではない。そのまま強めない。「事実」の引用と発話に照らし、合えば使い、合わなければ直すか保留にする。点の上下だけを根拠にしない。
7. 短い期間の記録から「成長した」「身についた」「できるようになった」と言い切らない。違いは「どの面談の、どの場面の、どの発話が、前とどう違ったか」を引用で示すだけにする。
8. 相手を評価しない。タイプ分けしない。名前を書かない。相手の発話は、講師の関わりの直後に何が続いたかの証拠としてだけ使う。
9. records/ のファイルは書き換えない。消さない。本人が直した所は変えない。
10. どのファイルも 1 行目に「暫定（検証用の記録から作った。本人は確かめていない）」と書く。

書くファイル（名前を変えない。ほかのファイルは作らない）
- index.md（索引）：作り直す。面談ごとに 1 行。面談 ID、何本目、相手の札、場面の発話番号、決めた行動、追跡の判定。
- recurring-scenes.md（繰り返す場面）：仮説を次の形で並べる。
  ## 仮説 H1：〈条件付きの行動仮説を一文で〉
  - 確からしさ：
  - 場面の形：〈相手の発話の形で書く。名前と固有の話題を入れない〉
  - 根拠：
    - 〔面談ID｜発話 n〕話者：「引用」
  - 例外・反例：
    - 〔面談ID｜発話 n〕話者：「引用」
  - まだ分からないこと：
- changes.md（変化）：同じ相手との前と後の面談で、同じ形の場面の行動がどう違ったかを、前と後の引用（上の根拠の形）で並べる。違いが見当たらなければ、そう書く。
- actions.md（一つの行動の表）：決めた行動ごとに 1 行の表。列は、決めた面談、行動、できたかの基準、追跡した面談、判定、根拠（上の形）。`;
  if ([...text].length > 4096) throw new Error(`夢への指示が長すぎます：${[...text].length} 字（4,096 字まで）`);
  return text;
}

export type RecorderResources = { environmentId: string; agentId: string; agentVersion: number; storeId: string; storeName: string };

/**
 * 記録係の環境・エージェント・メモリストアを作る。名前は呼ぶ側が決める（検証用と分かる名前にする）。
 * エージェントの道具は、ファイルの読み書きと探すものだけ（bash と web は切る）。
 */
export async function createRecorderResources(client: Anthropic, names: { environment: string; agent: string; store: string; storeDescription: string }): Promise<RecorderResources> {
  const environment = await client.beta.environments.create({
    name: names.environment,
    config: { type: "cloud", networking: { type: "limited" } },
  });
  const agent = await client.beta.agents.create({
    name: names.agent,
    model: RECORDER_MODEL,
    system: recorderSystem(),
    tools: [
      {
        type: "agent_toolset_20260401",
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
        configs: [
          { name: "bash", enabled: false },
          { name: "web_fetch", enabled: false },
          { name: "web_search", enabled: false },
        ],
      },
    ],
  });
  const store = await client.beta.memoryStores.create({ name: names.store, description: names.storeDescription });
  return { environmentId: environment.id, agentId: agent.id, agentVersion: agent.version, storeId: store.id, storeName: names.store };
}

export type SessionUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  activeSeconds: number | null;
  /** 公開価格での費用（最小単位の文字列）。記録のファイルには書かず、呼ぶ側が報告にだけ使う */
  listCostMinor: string | null;
};

type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens?: number | null; ephemeral_5m_input_tokens?: number | null } | null;
  active_seconds?: number | null;
  list_cost?: { amount: string } | null;
};

/** セッションと夢の使用量を、同じ形にそろえる */
export function usageOf(u: UsageLike | null | undefined): SessionUsage {
  const cacheWrite = u?.cache_creation_input_tokens ?? (u?.cache_creation ? (u.cache_creation.ephemeral_1h_input_tokens ?? 0) + (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : 0);
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: cacheWrite,
    activeSeconds: u?.active_seconds ?? null,
    listCostMinor: u?.list_cost?.amount ?? null,
  };
}

/**
 * 使用量を、入力トークンの量に換算する（夢の見張りに使う。金額は書かない）。
 * 重みは、入力を 1 としたときの公開価格の比：キャッシュの書き込み 1.25、キャッシュの読み出し 0.1、出力 5。
 */
export function inputEquivalentTokens(u: Pick<SessionUsage, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">): number {
  return Math.round(u.inputTokens + u.cacheWriteTokens * 1.25 + u.cacheReadTokens * 0.1 + u.outputTokens * 5);
}

export type RecordRun = {
  sessionId: string;
  ms: number;
  usage: SessionUsage;
  /** 記録係が使った道具の回数（名前ごと） */
  toolUses: Record<string, number>;
  /** 記録係の最後の報告 */
  report: string;
  /** セッションの終わり方（end_turn など）。エラーがあればその文 */
  stopReason: string | null;
  errors: string[];
};

export type RecordInterviewParams = {
  resources: Pick<RecorderResources, "environmentId" | "agentId" | "agentVersion" | "storeId">;
  interviewId: string;
  markdown: string;
  indexLineText: string;
  title: string;
  /** セッションの費用の上限（最小単位。USD ならセント）。呼ぶ側が渡す */
  budgetMinor: string;
  timeoutMs?: number;
  log?: (s: string) => void;
};

/**
 * 1 回の面談の記録を、記録係のセッションに書かせる。
 * 先に流れを開いてから文を送り、セッションが止まるまで待つ。
 */
export async function recordInterview(client: Anthropic, p: RecordInterviewParams): Promise<RecordRun> {
  const t0 = Date.now();
  const session = await client.beta.sessions.create({
    agent: { type: "agent", id: p.resources.agentId, version: p.resources.agentVersion },
    environment_id: p.resources.environmentId,
    title: p.title,
    resources: [{ type: "memory_store", memory_store_id: p.resources.storeId, access: "read_write", instructions: storeInstructions() }],
    budget: { type: "limit", max_list_cost: { amount: p.budgetMinor, currency: "USD" } },
  });
  const toolUses: Record<string, number> = {};
  const errors: string[] = [];
  let report = "";
  let stopReason: string | null = null;
  const stream = await client.beta.sessions.events.stream(session.id);
  await client.beta.sessions.events.send(session.id, {
    events: [{ type: "user.message", content: [{ type: "text", text: recorderMessage(p.interviewId, p.markdown, p.indexLineText) }] }],
  });
  const timeout = setTimeout(() => stream.controller.abort(), p.timeoutMs ?? 300000);
  try {
    loop: for await (const event of stream) {
      switch (event.type) {
        case "agent.message":
          report = event.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("");
          break;
        case "agent.tool_use":
          toolUses[event.name] = (toolUses[event.name] ?? 0) + 1;
          break;
        case "session.error":
          errors.push(JSON.stringify(event.error));
          break;
        case "session.status_idle":
          stopReason = event.stop_reason.type;
          if (event.stop_reason.type !== "requires_action") break loop;
          break;
        case "session.status_terminated":
          stopReason = "terminated";
          break loop;
      }
    }
  } catch (e) {
    errors.push(`流れが切れました：${(e as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
  const done = await client.beta.sessions.retrieve(session.id);
  const run: RecordRun = { sessionId: session.id, ms: Date.now() - t0, usage: usageOf(done.usage as UsageLike), toolUses, report, stopReason: stopReason ?? done.status, errors };
  p.log?.(`記録係 ${p.interviewId}：${run.ms} ms、止まり方 ${run.stopReason}、道具 ${JSON.stringify(toolUses)}`);
  return run;
}

export type StoredFile = { id: string; path: string; content: string };

/** メモリストアのファイルを、中身ごとすべて読む */
export async function readStore(client: Anthropic, storeId: string): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  for await (const m of client.beta.memoryStores.memories.list(storeId, { view: "full", limit: 20 })) {
    if (m.type !== "memory") continue;
    out.push({ id: m.id, path: m.path, content: m.content ?? "" });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export type StoredRecordCheck = {
  path: string;
  found: boolean;
  /** 渡した文と、読み返した文が同じか（末尾の改行の違いは数えない） */
  identical: boolean;
  /** 違ったとき、最初に違った行（1 始まり）と、その行の渡した文・読み返した文 */
  firstDiff: { line: number; expected: string; actual: string } | null;
  check: RecordCheck | null;
};

/** 読み返した記録が、渡した文と同じか、性質の言葉と名前が無いかを確かめる */
export function checkStoredRecord(files: StoredFile[], interviewId: string, expectedMarkdown: string, names: string[] = []): StoredRecordCheck {
  const path = recordPath(interviewId);
  const file = files.find((f) => f.path === path);
  if (!file) return { path, found: false, identical: false, firstDiff: null, check: null };
  const a = expectedMarkdown.trimEnd().split("\n");
  const b = file.content.trimEnd().split("\n");
  let firstDiff: StoredRecordCheck["firstDiff"] = null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      firstDiff = { line: i + 1, expected: a[i] ?? "（行が無い）", actual: b[i] ?? "（行が無い）" };
      break;
    }
  }
  return { path, found: true, identical: firstDiff === null, firstDiff, check: checkMarkdown(file.content, path, names) };
}

export type DreamStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export type DreamRun = {
  dreamId: string;
  status: DreamStatus;
  ms: number;
  usage: SessionUsage;
  /** 見張りで使った換算の量と、上限 */
  inputEquivalent: number;
  capInputEquivalent: number;
  /** 上限を超えたので取り消したか */
  canceledByCap: boolean;
  outputStoreId: string | null;
  sessionId: string | null;
  error: string | null;
  /** 見張りの記録（経過の秒と、その時の換算の量） */
  samples: { sec: number; status: string; inputEquivalent: number }[];
};

export type DreamParams = {
  storeId: string;
  sessionIds: string[];
  instructions: string;
  model?: string;
  /** 使用量の上限（入力トークン換算）。超えたら取り消す */
  capInputEquivalent: number;
  pollMs?: number;
  /** これより長くかかったら取り消す */
  timeoutMs?: number;
  log?: (s: string) => void;
  /** 夢の ID が決まったらすぐ呼ぶ（途中で止まっても、あとで取り消せるように控える） */
  onCreated?: (dreamId: string) => void;
};

/** 夢を 1 回回す。出力は新しいメモリストア（入力のストアは変わらない）。使用量を見張り、上限を超えたら取り消す */
export async function runDream(client: Anthropic, p: DreamParams): Promise<DreamRun> {
  const t0 = Date.now();
  const created = await client.beta.dreams.create({
    inputs: [
      { type: "memory_store", memory_store_id: p.storeId },
      { type: "sessions", session_ids: p.sessionIds },
    ],
    model: p.model ?? DREAM_MODEL,
    instructions: p.instructions,
  });
  p.onCreated?.(created.id);
  p.log?.(`夢 ${created.id}：始めた（${created.status}）`);
  const samples: DreamRun["samples"] = [];
  let canceledByCap = false;
  let dream = created;
  for (;;) {
    await new Promise((r) => setTimeout(r, p.pollMs ?? 10000));
    dream = await client.beta.dreams.retrieve(created.id);
    const eq = inputEquivalentTokens(usageOf(dream.usage as UsageLike));
    const sec = Math.round((Date.now() - t0) / 1000);
    samples.push({ sec, status: dream.status, inputEquivalent: eq });
    p.log?.(`夢 ${sec} 秒：${dream.status}、入力トークン換算 ${eq}`);
    if (dream.status === "completed" || dream.status === "failed" || dream.status === "canceled") break;
    const overCap = eq > p.capInputEquivalent;
    const overTime = Date.now() - t0 > (p.timeoutMs ?? 1800000);
    if (overCap || overTime) {
      canceledByCap = overCap;
      p.log?.(overCap ? "上限を超えたので取り消す" : "時間がかかりすぎたので取り消す");
      await client.beta.dreams.cancel(created.id);
    }
  }
  const usage = usageOf(dream.usage as UsageLike);
  return {
    dreamId: dream.id,
    status: dream.status as DreamStatus,
    ms: Date.now() - t0,
    usage,
    inputEquivalent: inputEquivalentTokens(usage),
    capInputEquivalent: p.capInputEquivalent,
    canceledByCap,
    outputStoreId: dream.outputs[0]?.memory_store_id ?? null,
    sessionId: dream.session_id,
    error: dream.error ? JSON.stringify(dream.error) : null,
    samples,
  };
}
