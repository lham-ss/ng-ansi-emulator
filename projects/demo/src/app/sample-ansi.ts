/**
 * Hand-built sample ANSI byte stream.
 *
 * Demonstrates: SGR colors (foreground + iCE high-intensity backgrounds),
 * cursor positioning, double-line box drawing characters, shading blocks,
 * solid blocks, and a small animated reveal that benefits from baud-rate
 * playback. No external file needed — everything is bytes encoded inline.
 */

const ESC = 0x1b;

interface Builder {
  bytes: number[];
  emit(...b: number[]): Builder;
  csi(args: string, finalChar: string): Builder;
  sgr(...codes: number[]): Builder;
  pos(row: number, col: number): Builder;
  cls(): Builder;
  text(s: string): Builder;
  raw(...b: number[]): Builder;
  cp437(...b: number[]): Builder;
  newline(): Builder;
}

function builder(): Builder {
  const bytes: number[] = [];
  const self: Builder = {
    bytes,
    emit(...b: number[]) { bytes.push(...b); return self; },
    csi(args: string, finalChar: string) {
      bytes.push(ESC, 0x5b /* [ */);
      for (let i = 0; i < args.length; i++) bytes.push(args.charCodeAt(i));
      bytes.push(finalChar.charCodeAt(0));
      return self;
    },
    sgr(...codes: number[]) {
      return self.csi(codes.join(';'), 'm');
    },
    pos(row: number, col: number) {
      return self.csi(`${row};${col}`, 'H');
    },
    cls() {
      return self.csi('2', 'J').pos(1, 1);
    },
    text(s: string) {
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) bytes.push(c);
        else bytes.push(0x3f); // out-of-range chars become '?'
      }
      return self;
    },
    cp437(...b: number[]) {
      for (const v of b) bytes.push(v & 0xff);
      return self;
    },
    raw(...b: number[]) { bytes.push(...b); return self; },
    newline() { bytes.push(0x0d, 0x0a); return self; },
  };
  return self;
}

function buildSample(): number[] {
  const b = builder();

  // Reset, clear, home.
  b.sgr(0).cls();

  // Top border in light cyan double-line box, with title centered.
  b.sgr(1, 36); // bold cyan
  b.cp437(0xc9);
  for (let i = 0; i < 78; i++) b.cp437(0xcd);
  b.cp437(0xbb).newline();

  b.cp437(0xba);
  b.sgr(0, 1, 33); // bold yellow
  b.text('              ng-ansi-emulator  -  Angular 21  -  CP437 VGA 8x16              ');
  b.sgr(1, 36).cp437(0xba).newline();

  b.cp437(0xc8);
  for (let i = 0; i < 78; i++) b.cp437(0xcd);
  b.cp437(0xbc).newline();

  // Color palette demo — 16 fg colors against 16 bg colors via iCE.
  b.sgr(0).newline();
  b.text('  16-color VGA palette  (iCE backgrounds enabled)').newline();
  b.newline();

  for (let bg = 0; bg < 16; bg++) {
    const sgrBg = bg < 8 ? 40 + bg : 100 + (bg - 8); // Aixterm bright bg
    const fgPair = bg === 0 ? 15 : 0;
    const sgrFg = fgPair < 8 ? 30 + fgPair : 90 + (fgPair - 8);
    b.sgr(sgrBg, sgrFg).text(` ${bg.toString().padStart(2)} `);
  }
  b.sgr(0).newline().newline();

  // Shading and block demo
  b.text('  Shading + blocks:  ');
  b.sgr(1, 31); // bright red
  for (const ch of [0xb0, 0xb1, 0xb2, 0xdb, 0xdb, 0xb2, 0xb1, 0xb0]) b.cp437(ch);
  b.sgr(0).text(' ');
  b.sgr(1, 32); // bright green
  for (const ch of [0xb0, 0xb1, 0xb2, 0xdb, 0xdb, 0xb2, 0xb1, 0xb0]) b.cp437(ch);
  b.sgr(0).text(' ');
  b.sgr(1, 34); // bright blue
  for (const ch of [0xb0, 0xb1, 0xb2, 0xdb, 0xdb, 0xb2, 0xb1, 0xb0]) b.cp437(ch);
  b.sgr(0).newline().newline();

  // Half-block "skyline"
  b.text('  Half-block skyline:').newline();
  b.text('  ');
  const skyline = [0xdf, 0xdc, 0xdb, 0xdc, 0xdf, 0xdb, 0xdc, 0xdf, 0xdb, 0xdb, 0xdf, 0xdc, 0xdf, 0xdb, 0xdc, 0xdb, 0xdf, 0xdc, 0xdb, 0xdf, 0xdc, 0xdb, 0xdf, 0xdc];
  for (let i = 0; i < skyline.length; i++) {
    b.sgr(0, 1, 30 + (i % 7) + 1).cp437(skyline[i]!);
  }
  b.sgr(0).newline().newline();

  // Animated reveal — write a row of dots then animate by repositioning.
  b.text('  Animated reveal (watch with baud > 0):').newline();
  b.sgr(1, 33);
  // Draw a horizontal track
  b.text('  '); for (let i = 0; i < 60; i++) b.cp437(0xc4); b.newline();
  // Marker line below — we'll move the cursor and write one char per step
  b.sgr(1, 35);
  // We can't actually animate frame-by-frame from within static bytes
  // without re-positioning, so use cursor moves to make it readable:
  b.text('  ');
  for (let i = 0; i < 60; i++) {
    // alternate two chars to give it rhythm under baud-rate playback
    b.cp437((i & 1) ? 0xfe : 0xb1);
  }
  b.sgr(0).newline().newline();

  // Footer
  b.sgr(0, 90).text('  Use the controls above to swap files, change baud, or toggle iCE colors.').newline();
  b.sgr(0);

  // EOF marker (DOS convention).
  b.raw(0x1a);

  return b.bytes;
}

export const SAMPLE_ANSI_BYTES: readonly number[] = Object.freeze(buildSample());
