// 画面の文言に、人物の性質の言葉・優劣・「〜すべき」が入っていないこと（決まり 3。CLAUDE.md「守ること」）。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { scanText } from "../engine/forbidden-words.mts";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return /\.(tsx|ts)$/.test(d.name) && !/\.test\./.test(d.name) ? [p] : [];
  });
}

describe("画面の文言（決まり 3）", () => {
  test("app/ の文言に性質の言葉が無い", () => {
    const hits = walk(path.resolve("app")).flatMap((f) => scanText(fs.readFileSync(f, "utf8"), path.relative(process.cwd(), f)));
    assert.deepEqual(
      hits.map((h) => `${h.field}: ${h.word} …${h.context}…`),
      [],
    );
  });
});
