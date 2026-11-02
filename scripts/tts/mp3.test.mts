import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { concatMp3, id3v2Length, readFrameHeader, stripForConcat } from "./mp3.mts";

// MPEG1 Layer III・128kbps・44.1kHz・モノラル・CRC なし。1 フレーム 417 バイト（パディングなし）。
const HEADER = [0xff, 0xfb, 0x90, 0xc0];
const FRAME_LENGTH = 417;

/** 音声フレーム（中身は fill で埋める） */
function audioFrame(fill: number): Uint8Array {
  const f = new Uint8Array(FRAME_LENGTH).fill(fill);
  f.set(HEADER, 0);
  return f;
}

/** 先頭の Xing／Info ヘッダーフレーム。モノラルの MPEG1 ではヘッダーの後 17 バイトの位置に置く。 */
function vbrFrame(tag: "Xing" | "Info"): Uint8Array {
  const f = new Uint8Array(FRAME_LENGTH);
  f.set(HEADER, 0);
  f.set([...tag].map((c) => c.charCodeAt(0)), 4 + 17);
  return f;
}

function id3v2(payload: number): Uint8Array {
  const tag = new Uint8Array(10 + payload);
  tag.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00], 0); // "ID3" v2.4
  tag.set([0, 0, (payload >> 7) & 0x7f, payload & 0x7f], 6); // syncsafe
  return tag;
}

function id3v1(): Uint8Array {
  const tag = new Uint8Array(128);
  tag.set([0x54, 0x41, 0x47], 0); // "TAG"
  return tag;
}

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("MP3 のつなぎ方", () => {
  test("フレームヘッダーから長さを読む", () => {
    const h = readFrameHeader(audioFrame(1), 0);
    assert.deepEqual(h, { mpeg1: true, mono: true, hasCrc: false, length: FRAME_LENGTH });
    assert.equal(readFrameHeader(new Uint8Array([0x00, 0x00, 0x00, 0x00]), 0), null);
  });

  test("ID3v2 タグの長さを読む", () => {
    assert.equal(id3v2Length(id3v2(300)), 310);
    assert.equal(id3v2Length(audioFrame(1)), 0);
  });

  test("タグもヘッダーフレームも無ければ、そのまま並べる", () => {
    const a = join(audioFrame(1), audioFrame(2));
    const b = join(audioFrame(3));
    assert.deepEqual(concatMp3([a, b]), join(a, b));
  });

  test("ID3v2・ID3v1 タグと Xing／Info ヘッダーフレームを外してから並べる", () => {
    const a = join(id3v2(50), vbrFrame("Info"), audioFrame(1), audioFrame(2), id3v1());
    const b = join(id3v2(20), vbrFrame("Xing"), audioFrame(3), id3v1());
    assert.deepEqual(concatMp3([a, b]), join(audioFrame(1), audioFrame(2), audioFrame(3)));
  });

  test("音声フレームは外さない", () => {
    const a = join(audioFrame(1), audioFrame(2));
    assert.deepEqual(stripForConcat(a), a);
  });

  test("1 本だけでも、つなぐのと同じように整える", () => {
    const a = join(vbrFrame("Info"), audioFrame(5));
    assert.deepEqual(concatMp3([a]), audioFrame(5));
  });
});
