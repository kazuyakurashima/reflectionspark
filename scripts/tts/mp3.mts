// 分けて作った MP3 を 1 本につなぐ。
// MP3 はフレームの並びなので、フレームをそのまま並べればつながる。ただし各ファイルの
// 頭の ID3v2 タグ・末尾の ID3v1 タグと、先頭フレームの Xing／Info／VBRI ヘッダー（そのファイルだけの
// 長さを持つ）は、つないだ後に残ると再生時間の読み違いのもとになるので、外してから並べる。

/** フレームヘッダーから分かること（Layer III だけを扱う） */
export type FrameHeader = {
  mpeg1: boolean;
  mono: boolean;
  hasCrc: boolean;
  /** フレームの長さ（バイト） */
  length: number;
};

const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
};

/** offset の位置にある Layer III のフレームヘッダーを読む。読めなければ null。 */
export function readFrameHeader(buf: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > buf.length) return null;
  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];
  const b3 = buf[offset + 3];
  if (buf[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const version = (b1 >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=予約
  const layer = (b1 >> 1) & 0x03; // 1=Layer III
  if (version === 1 || layer !== 1) return null;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const mpeg1 = version === 3;
  const kbps = (mpeg1 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  const padding = (b2 >> 1) & 0x01;
  const length = Math.floor(((mpeg1 ? 144000 : 72000) * kbps) / sampleRate) + padding;

  return {
    mpeg1,
    mono: ((b3 >> 6) & 0x03) === 3,
    hasCrc: (b1 & 0x01) === 0,
    length,
  };
}

/** 頭の ID3v2 タグの長さ（無ければ 0） */
export function id3v2Length(buf: Uint8Array): number {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0; // "ID3"
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const footer = (buf[5] & 0x10) !== 0 ? 10 : 0;
  return Math.min(buf.length, 10 + size + footer);
}

/** 先頭フレームが Xing／Info／VBRI ヘッダーなら true */
export function isVbrHeaderFrame(buf: Uint8Array, offset: number, header: FrameHeader): boolean {
  const sideInfo = header.mpeg1 ? (header.mono ? 17 : 32) : header.mono ? 9 : 17;
  const xingAt = offset + 4 + (header.hasCrc ? 2 : 0) + sideInfo;
  const tag = ascii(buf, xingAt, 4);
  if (tag === "Xing" || tag === "Info") return true;
  return ascii(buf, offset + 4 + 32, 4) === "VBRI";
}

/** 1 本の MP3 から、つなぐときに邪魔になるタグとヘッダーを外したフレームの並びを返す。 */
export function stripForConcat(buf: Uint8Array): Uint8Array {
  let start = id3v2Length(buf);
  let end = buf.length;
  if (end - start >= 128 && ascii(buf, end - 128, 3) === "TAG") end -= 128; // ID3v1

  const header = readFrameHeader(buf, start);
  if (header !== null && start + header.length <= end && isVbrHeaderFrame(buf, start, header)) {
    start += header.length;
  }
  return buf.subarray(start, end);
}

/** MP3 を順につなぐ。 */
export function concatMp3(parts: Uint8Array[]): Uint8Array {
  const stripped = parts.map(stripForConcat);
  const total = stripped.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of stripped) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function ascii(buf: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > buf.length) return "";
  return String.fromCharCode(...buf.subarray(offset, offset + length));
}
