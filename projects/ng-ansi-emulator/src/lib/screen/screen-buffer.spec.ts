import { ScreenBuffer, ATTR_BOLD } from './screen-buffer';

describe('ScreenBuffer', () => {
  let buf: ScreenBuffer;
  beforeEach(() => { buf = new ScreenBuffer(10, 4); });

  it('initializes to spaces', () => {
    for (let i = 0; i < 40; i++) {
      expect(buf.cells[i]!.ch).toBe(0x20);
    }
  });

  it('putChar advances cursor and wraps', () => {
    for (let i = 0; i < 10; i++) buf.putChar(0x41);
    expect(buf.cursor.x).toBe(10); // about to wrap on next put
    buf.putChar(0x42);
    expect(buf.cursor.x).toBe(1);
    expect(buf.cursor.y).toBe(1);
  });

  it('lineFeed past last row scrolls', () => {
    buf.putChar(0x58); // 'X' at row 0
    buf.lineFeed(); buf.lineFeed(); buf.lineFeed(); buf.lineFeed();
    // Original 'X' should now be off-screen (scrolled away).
    expect(buf.cellAt(0, 0)!.ch).toBe(0x20);
  });

  it('moveTo clamps within bounds', () => {
    buf.moveTo(100, 100);
    expect(buf.cursor.y).toBe(3);
    expect(buf.cursor.x).toBe(9);
    buf.moveTo(-5, -5);
    expect(buf.cursor.y).toBe(0);
    expect(buf.cursor.x).toBe(0);
  });

  it('save/restore cursor preserves position', () => {
    buf.moveTo(2, 3);
    buf.saveCursor();
    buf.moveTo(1, 1);
    buf.restoreCursor();
    expect(buf.cursor.y).toBe(1);
    expect(buf.cursor.x).toBe(2);
  });

  it('eraseLine 0 clears from cursor to end of line', () => {
    for (let i = 0; i < 10; i++) buf.putChar(0x41);
    buf.cursor.x = 4;
    buf.eraseLine(0);
    expect(buf.cellAt(3, 0)!.ch).toBe(0x41);
    expect(buf.cellAt(4, 0)!.ch).toBe(0x20);
    expect(buf.cellAt(9, 0)!.ch).toBe(0x20);
  });

  it('bold attribute writes to high-intensity fg row', () => {
    buf.cursor.fg = 4; // red
    buf.cursor.attr = ATTR_BOLD;
    buf.putChar(0x41);
    expect(buf.cellAt(0, 0)!.fg).toBe(12); // bright red
  });
});
