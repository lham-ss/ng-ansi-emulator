import { AnsiParser } from './ansi-parser';
import { ATTR_BOLD, ATTR_REVERSE, ScreenBuffer } from '../screen/screen-buffer';

function feed(parser: AnsiParser, ...chunks: (string | number[])[]): void {
  for (const c of chunks) {
    if (typeof c === 'string') {
      const arr = new Uint8Array(c.length);
      for (let i = 0; i < c.length; i++) arr[i] = c.charCodeAt(i);
      parser.feed(arr);
    } else {
      parser.feed(new Uint8Array(c));
    }
  }
}

describe('AnsiParser', () => {
  let buffer: ScreenBuffer;
  let parser: AnsiParser;

  beforeEach(() => {
    buffer = new ScreenBuffer(80, 25);
    parser = new AnsiParser(buffer);
  });

  it('writes printable bytes at the cursor and advances', () => {
    feed(parser, 'Hi');
    expect(buffer.cellAt(0, 0)!.ch).toBe(0x48);
    expect(buffer.cellAt(1, 0)!.ch).toBe(0x69);
    expect(buffer.cursor.x).toBe(2);
  });

  it('handles CRLF', () => {
    feed(parser, 'A\r\nB');
    expect(buffer.cellAt(0, 0)!.ch).toBe(0x41);
    expect(buffer.cellAt(0, 1)!.ch).toBe(0x42);
    expect(buffer.cursor.y).toBe(1);
    expect(buffer.cursor.x).toBe(1);
  });

  it('SGR 31 sets red foreground (VGA index 4)', () => {
    feed(parser, '\x1b[31mX');
    expect(buffer.cellAt(0, 0)!.fg).toBe(4);
  });

  it('SGR 1;31 = bold red promotes to bright red (palette idx 12)', () => {
    feed(parser, '\x1b[1;31mX');
    expect(buffer.cellAt(0, 0)!.fg).toBe(12);
  });

  it('SGR 0 resets all attributes and colors', () => {
    feed(parser, '\x1b[1;31mA\x1b[0mB');
    expect(buffer.cellAt(0, 0)!.fg).toBe(12);
    expect(buffer.cellAt(1, 0)!.fg).toBe(7);
    expect(buffer.cellAt(1, 0)!.attr & ATTR_BOLD).toBe(0);
  });

  it('SGR 7 reverse swaps fg and bg at write time', () => {
    feed(parser, '\x1b[31;42;7mX');
    const cell = buffer.cellAt(0, 0)!;
    expect(cell.fg).toBe(2);
    expect(cell.bg).toBe(4);
    expect(cell.attr & ATTR_REVERSE).toBe(ATTR_REVERSE);
  });

  it('CUP positions cursor (1-based)', () => {
    feed(parser, '\x1b[5;10HX');
    expect(buffer.cursor.y).toBe(4);
    expect(buffer.cellAt(9, 4)!.ch).toBe(0x58);
  });

  it('CUF moves cursor forward', () => {
    feed(parser, 'A\x1b[3CB');
    expect(buffer.cellAt(0, 0)!.ch).toBe(0x41);
    expect(buffer.cellAt(4, 0)!.ch).toBe(0x42);
  });

  it('save/restore cursor (s/u)', () => {
    feed(parser, 'AB\x1b[s\r\n\r\n\x1b[uX');
    expect(buffer.cellAt(2, 0)!.ch).toBe(0x58);
  });

  it('clears screen on CSI 2J', () => {
    feed(parser, 'HELLO\x1b[2J');
    for (let x = 0; x < 5; x++) {
      expect(buffer.cellAt(x, 0)!.ch).toBe(0x20);
    }
  });

  it('survives a CSI sequence split across chunks', () => {
    parser.feed(new Uint8Array([0x1b, 0x5b, 0x33]));
    parser.feed(new Uint8Array([0x31, 0x6d]));
    parser.feed(new Uint8Array([0x58]));
    expect(buffer.cellAt(0, 0)!.ch).toBe(0x58);
    expect(buffer.cellAt(0, 0)!.fg).toBe(4);
  });

  it('SUB (0x1A) marks EOF and ignores following bytes', () => {
    feed(parser, 'A', [0x1a], 'BCD');
    expect(parser.eofSeen).toBe(true);
    expect(buffer.cellAt(0, 0)!.ch).toBe(0x41);
    expect(buffer.cellAt(1, 0)!.ch).toBe(0x20);
  });

  it('renders CP437 high bytes (0x80-0xFF) as glyphs', () => {
    feed(parser, [0xc9, 0xcd, 0xbb]);
    expect(buffer.cellAt(0, 0)!.ch).toBe(0xc9);
    expect(buffer.cellAt(1, 0)!.ch).toBe(0xcd);
    expect(buffer.cellAt(2, 0)!.ch).toBe(0xbb);
  });

  it('iCE-color: SGR 5 + bg index < 8 promotes to high-intensity bg', () => {
    buffer.iceColors = true;
    feed(parser, '\x1b[5;42mX');
    expect(buffer.cellAt(0, 0)!.bg).toBe(10);
  });

  it('iCE-color OFF: blink bit does not promote bg', () => {
    buffer.iceColors = false;
    feed(parser, '\x1b[5;42mX');
    expect(buffer.cellAt(0, 0)!.bg).toBe(2);
  });
});
