/**
 * SAUCE (Standard Architecture for Universal Comment Extensions) parser.
 *
 * Spec: http://www.acid.org/info/sauce/sauce.htm
 *
 * Layout (when present):
 *   ...file body...
 *   0x1A (SUB / EOF marker, optional)
 *   [optional comment block: "COMNT" + N*64 bytes]
 *   "SAUCE00" + 121 bytes of fixed fields = 128 bytes total
 *
 * The trailing 128 bytes are a fixed-format struct. We pull what's useful
 * for playback: title/author/group, dimensions (TInfo1/2), iCE-color flag,
 * and the embedded font name (which informs CP437 vs Amiga, etc).
 */

export interface SauceRecord {
  title: string;
  author: string;
  group: string;
  date: string; // CCYYMMDD
  fileSize: number;
  dataType: number;
  fileType: number;
  /** TInfo1 — for Character/ANSI: width in characters. */
  tInfo1: number;
  /** TInfo2 — for Character/ANSI: height (number of lines). */
  tInfo2: number;
  tInfo3: number;
  tInfo4: number;
  comments: number; // count of 64-byte comment lines
  flags: number;
  tInfoS: string; // font name (e.g. "IBM VGA")
  /** Convenience: true if iCE-colors flag (bit 0 of flags) is set. */
  iceColors: boolean;
  /** Convenience: true if 8-pixel font (vs 9-pixel) — bit 1 of flags. */
  letterSpacing8px: boolean;
  /** Convenience: aspect-ratio flag — bits 3-4 of flags. 0=legacy, 1=square, 2=stretch. */
  aspectRatio: 0 | 1 | 2;
  /** Total trailing bytes occupied by SAUCE (incl. comment block + EOF). */
  trailingByteCount: number;
}

export interface SauceParseResult {
  /** SAUCE record if present and valid, otherwise null. */
  sauce: SauceRecord | null;
  /**
   * The body of the file with the SAUCE trailer (and any preceding 0x1A EOF
   * marker / comment block) sliced off. This is the stream you feed into
   * the ANSI parser.
   */
  body: Uint8Array;
}

const SAUCE_ID = [0x53, 0x41, 0x55, 0x43, 0x45, 0x30, 0x30]; // "SAUCE00"
const COMNT_ID = [0x43, 0x4f, 0x4d, 0x4e, 0x54];             // "COMNT"
const SAUCE_RECORD_LEN = 128;
const COMMENT_LINE_LEN = 64;

function asciiSlice(data: Uint8Array, start: number, len: number): string {
  let end = start + len;
  // Strip trailing spaces/nulls (SAUCE pads with spaces).
  while (end > start && (data[end - 1] === 0x20 || data[end - 1] === 0x00)) end--;
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(data[i]!);
  return s;
}

function matchesAt(data: Uint8Array, pos: number, sig: number[]): boolean {
  if (pos + sig.length > data.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (data[pos + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Parse a complete .ANS file and split off any SAUCE trailer.
 */
export function parseSauce(data: Uint8Array): SauceParseResult {
  if (data.length < SAUCE_RECORD_LEN) {
    return { sauce: null, body: data };
  }
  const sauceStart = data.length - SAUCE_RECORD_LEN;
  if (!matchesAt(data, sauceStart, SAUCE_ID)) {
    return { sauce: null, body: data };
  }

  // Fixed offsets within the 128-byte SAUCE record (relative to sauceStart):
  //  0..4  "SAUCE"
  //  5..6  version "00"
  //  7..41  Title (35)
  // 42..61  Author (20)
  // 62..81  Group (20)
  // 82..89  Date (8)
  // 90..93  FileSize (uint32 LE)
  // 94      DataType
  // 95      FileType
  // 96..97  TInfo1 (uint16 LE)
  // 98..99  TInfo2
  //100..101 TInfo3
  //102..103 TInfo4
  //104      Comments
  //105      Flags
  //106..127 TInfoS (22)
  const off = sauceStart;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const title = asciiSlice(data, off + 7, 35);
  const author = asciiSlice(data, off + 42, 20);
  const group = asciiSlice(data, off + 62, 20);
  const date = asciiSlice(data, off + 82, 8);
  const fileSize = dv.getUint32(off + 90, true);
  const dataType = data[off + 94]!;
  const fileType = data[off + 95]!;
  const tInfo1 = dv.getUint16(off + 96, true);
  const tInfo2 = dv.getUint16(off + 98, true);
  const tInfo3 = dv.getUint16(off + 100, true);
  const tInfo4 = dv.getUint16(off + 102, true);
  const comments = data[off + 104]!;
  const flags = data[off + 105]!;
  const tInfoS = asciiSlice(data, off + 106, 22);

  // Locate optional comment block, immediately preceding SAUCE.
  let trailingStart = sauceStart;
  if (comments > 0) {
    const commentBlockLen = comments * COMMENT_LINE_LEN + COMNT_ID.length;
    const commentStart = sauceStart - commentBlockLen;
    if (commentStart >= 0 && matchesAt(data, commentStart, COMNT_ID)) {
      trailingStart = commentStart;
    }
  }
  // The SUB (0x1A) EOF marker, if present, sits just before the trailer.
  if (trailingStart > 0 && data[trailingStart - 1] === 0x1a) {
    trailingStart -= 1;
  }

  const aspectRatioBits = (flags >>> 3) & 0x03;
  const aspectRatio: 0 | 1 | 2 = aspectRatioBits === 1 ? 1 : aspectRatioBits === 2 ? 2 : 0;

  const sauce: SauceRecord = {
    title,
    author,
    group,
    date,
    fileSize,
    dataType,
    fileType,
    tInfo1,
    tInfo2,
    tInfo3,
    tInfo4,
    comments,
    flags,
    tInfoS,
    iceColors: (flags & 0x01) !== 0,
    letterSpacing8px: (flags & 0x02) !== 0,
    aspectRatio,
    trailingByteCount: data.length - trailingStart,
  };

  // The body is everything before the trailer. SAUCE.FileSize is advisory —
  // some tools report it incorrectly — so prefer the structural boundary.
  const body = data.subarray(0, trailingStart);
  return { sauce, body };
}

/**
 * Heuristic: recommended characters-per-second for playback. SAUCE doesn't
 * carry a direct baud field, but TInfo1 (width) for ANSImations is stable
 * and the convention is 14400-baud ≈ 1440 cps for modern art and 2400 baud
 * ≈ 240 cps for true period pieces.
 */
export function recommendedCps(sauce: SauceRecord | null): number {
  if (!sauce) return 14400 / 10;
  // No reliable field; default to 14400 baud equivalent.
  return 14400 / 10;
}
