# ng-ansi-emulator

Angular 21 ANSI emulator for HTML5 Canvas. Plays back BBS-style `.ANS` files
with authentic CP437 8x16 VGA bitmap glyphs and configurable baud-rate timing
so animations reveal at the cadence they were originally drawn at.

## Workspace layout

```
projects/
  ng-ansi-emulator/   library: parser, SAUCE, screen buffer, font, player, component
  demo/               app:     interactive playground with sample art + file picker
```

## Install & run

```bash
npm install
npm start                # dev server for the demo app on http://localhost:4200
npm run build            # ng-packagr build of the library to dist/ng-ansi-emulator
npm test                 # Karma + Jasmine unit tests for the library
```

## Library API

```ts
import { NgAnsiCanvasComponent, AnsiPlayerService } from 'ng-ansi-emulator';

@Component({
  imports: [NgAnsiCanvasComponent],
  template: `
    <ng-ansi-canvas
      [source]="bytes"
      [baud]="14400"
      [iceColors]="true"
      [scale]="2"
      [viewportRows]="25"
      [followCursor]="true"
      (stateChange)="onState($event)" />
  `,
})
export class MyComponent {
  bytes = new Uint8Array(/* .ANS file bytes */);
  onState(s: PlayerState) { /* ... */ }
}
```

## Scrollback for tall art

The screen buffer holds the **full** content height (taken from `SAUCE.tInfo2`,
or `1000` rows by default for files without SAUCE), so nothing scrolls off
the top. The component renders only `viewportRows` rows at a time and
exposes scroll APIs:

- Mouse wheel over the canvas
- Keyboard (PgUp / PgDn / Home / End / arrows) when the canvas has focus
- Programmatic: `player.scrollTo(row)`, `player.scrollBy(delta)`,
  `player.scrollToCursor()`
- `followCursor` (default `true`) auto-scrolls during playback to keep the
  cursor row visible — disable it if you want the user's manual scroll
  position respected mid-playback.

`PlayerState` exposes `scrollTop`, `maxScrollTop`, `viewportRows`, and
`bufferRows` so you can wire up your own scrollbar if you don't like the
mouse-wheel UX. The demo binds `<input type="range">` to those signals as
an example.

You can also drive the `AnsiPlayerService` directly if you want a custom UI:

```ts
const player = inject(AnsiPlayerService);
player.attachCanvas(canvasEl, { scale: 2 });
player.load(bytes, { baud: 14400, iceColors: true });
player.play();      // pause / restart / renderToEnd / setBaud / setIceColors
```

## Architecture

- **Screen buffer** (`lib/screen/`) — 80x25 (or SAUCE-defined) cell grid, each
  cell carries a CP437 codepoint + VGA palette indices + attribute bits.
  Tracks cursor state and dirty rows for partial repaints.
- **Parser** (`lib/parser/ansi-parser.ts`) — incremental ESC `[` CSI state
  machine. Survives chunked input across `feed()` calls — essential for
  baud-rate playback. Supports the full BBS subset: cursor moves, SGR
  colors (with ANSI→VGA bit-swap), erase-in-display/line, save/restore
  cursor, iCE-colors mode.
- **SAUCE** (`lib/parser/sauce.ts`) — extracts the trailing 128-byte
  metadata record (title, author, group, dimensions, iCE flag, font name)
  and slices the COMNT block + EOF marker off the body.
- **Font** (`lib/font/cp437-font.ts`) — CP437 8x16 bitmap glyphs encoded as
  binary-literal `Uint8Array`, plus a `setFontData(bytes)` hook for swapping
  in a canonical IBM VGA ROM dump (e.g. DOSBox `vga.f16`).
- **Renderer** (`lib/font/glyph-renderer.ts`) — rasterizes the buffer into
  `ImageData` (one putImageData per row in dirty mode) and blits to the
  canvas. Pixel-perfect; no font smoothing.
- **Player** (`lib/player/ansi-player.service.ts`) — drips bytes into the
  parser at `baud / 10` chars-per-second on a `requestAnimationFrame`
  loop, then calls `renderDirty()` each frame.
- **Component** (`lib/components/ng-ansi-canvas.component.ts`) — standalone
  Angular 21 wrapper with signal inputs for `source`, `baud`, `iceColors`,
  `scale`, and a `(stateChange)` output that emits the player's signal.

## Color mapping (the gotcha)

ANSI SGR codes use RGB-bit ordering (red=1, green=2, blue=4) while VGA
hardware palette indices use BGR (blue=1, green=2, red=4). The parser swaps
bits 0 and 2 via the `ANSI_TO_VGA` table — without this, "red" art renders
blue. Other ANSI emulators that don't use a true VGA palette mostly hide
this by storing CSS colors directly; we keep the VGA indices because the
hand-encoded font expects them.

## Replacing the font

The bundled font is a starter — full ASCII 0x20–0x7E plus the heavy box-
drawing/block characters at 0xB0–0xDF. Other slots are deliberately drawn
as a hollow "tofu" rectangle. To use the canonical IBM VGA ROM font:

```ts
import { setFontData } from 'ng-ansi-emulator';

const vgaRom: Uint8Array = await fetch('/assets/vga.f16')
  .then(r => r.arrayBuffer())
  .then(b => new Uint8Array(b));
setFontData(vgaRom);  // 4096 bytes, 256 glyphs * 16 rows
```

## Tests

Karma + Jasmine, run with `npm test`. Coverage is concentrated on the
parser (CSI handling, SGR, iCE colors, chunked input, EOF, CP437 high
bytes), SAUCE record extraction, and the screen buffer's wrap/scroll
semantics. A separate Node smoke harness exists in the workspace's
`outputs/smoke.ts` for quick pre-CI sanity runs.