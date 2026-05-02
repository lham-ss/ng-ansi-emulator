import { parseSauce } from './sauce';

function buildSauceFile(opts: {
  body: number[];
  title: string;
  author: string;
  group: string;
  flags?: number;
  tInfo1?: number;
  tInfo2?: number;
  comments?: string[];
}): Uint8Array {
  const { body, title, author, group, flags = 0, tInfo1 = 80, tInfo2 = 25, comments = [] } = opts;

  const result: number[] = [...body];
  // EOF marker
  result.push(0x1a);

  // Comment block (if any)
  if (comments.length > 0) {
    result.push(...'COMNT'.split('').map(c => c.charCodeAt(0)));
    for (const line of comments) {
      const padded = line.padEnd(64, ' ').slice(0, 64);
      for (let i = 0; i < 64; i++) result.push(padded.charCodeAt(i));
    }
  }

  // SAUCE record (128 bytes)
  const sauce = new Uint8Array(128);
  const w = (offset: number, str: string, len: number) => {
    const padded = str.padEnd(len, ' ').slice(0, len);
    for (let i = 0; i < len; i++) sauce[offset + i] = padded.charCodeAt(i);
  };

  w(0, 'SAUCE', 5);
  w(5, '00', 2);
  w(7, title, 35);
  w(42, author, 20);
  w(62, group, 20);
  w(82, '20240101', 8);
  // FileSize (uint32 LE) at 90 — leave 0
  sauce[94] = 1; // DataType: Character
  sauce[95] = 1; // FileType: ANSi
  // tInfo1, tInfo2 (uint16 LE)
  sauce[96] = tInfo1 & 0xff;
  sauce[97] = (tInfo1 >>> 8) & 0xff;
  sauce[98] = tInfo2 & 0xff;
  sauce[99] = (tInfo2 >>> 8) & 0xff;
  sauce[104] = comments.length;
  sauce[105] = flags;
  w(106, 'IBM VGA', 22);

  for (let i = 0; i < 128; i++) result.push(sauce[i]!);
  return new Uint8Array(result);
}

describe('parseSauce', () => {
  it('returns null sauce when file is too small', () => {
    const r = parseSauce(new Uint8Array(10));
    expect(r.sauce).toBeNull();
    expect(r.body.length).toBe(10);
  });

  it('returns null sauce when SAUCE id is absent', () => {
    const arr = new Uint8Array(200);
    arr.fill(0x41); // all 'A'
    const r = parseSauce(arr);
    expect(r.sauce).toBeNull();
  });

  it('parses title, author, group', () => {
    const file = buildSauceFile({
      body: [0x48, 0x69], // "Hi"
      title: 'TestTitle',
      author: 'TestAuthor',
      group: 'TestGroup',
    });
    const { sauce, body } = parseSauce(file);
    expect(sauce).not.toBeNull();
    expect(sauce!.title).toBe('TestTitle');
    expect(sauce!.author).toBe('TestAuthor');
    expect(sauce!.group).toBe('TestGroup');
    expect(body.length).toBe(2);
    expect(body[0]).toBe(0x48);
  });

  it('detects iceColors flag (bit 0)', () => {
    const file = buildSauceFile({
      body: [0x41],
      title: 't', author: 'a', group: 'g',
      flags: 0x01,
    });
    const { sauce } = parseSauce(file);
    expect(sauce!.iceColors).toBe(true);
  });

  it('extracts tInfo1/tInfo2 (width / height)', () => {
    const file = buildSauceFile({
      body: [0x41],
      title: 't', author: 'a', group: 'g',
      tInfo1: 132,
      tInfo2: 50,
    });
    const { sauce } = parseSauce(file);
    expect(sauce!.tInfo1).toBe(132);
    expect(sauce!.tInfo2).toBe(50);
  });

  it('strips comment block from body when present', () => {
    const file = buildSauceFile({
      body: [0x41, 0x42, 0x43],
      title: 't', author: 'a', group: 'g',
      comments: ['Line one of comment', 'Line two'],
    });
    const { sauce, body } = parseSauce(file);
    expect(sauce!.comments).toBe(2);
    expect(body.length).toBe(3); // body should not contain the COMNT block
    expect(body[0]).toBe(0x41);
    expect(body[2]).toBe(0x43);
  });

  it('strips the EOF (0x1A) byte from body', () => {
    const file = buildSauceFile({
      body: [0x41, 0x42],
      title: 't', author: 'a', group: 'g',
    });
    const { body } = parseSauce(file);
    expect(body.length).toBe(2);
    // EOF byte should NOT appear in the body
    for (let i = 0; i < body.length; i++) expect(body[i]).not.toBe(0x1a);
  });
});
