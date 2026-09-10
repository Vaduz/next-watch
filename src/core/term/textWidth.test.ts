import { describe, expect, it } from 'bun:test';
import { clipDisplay, displayWidth, padDisplay, truncateDisplay, wrapDisplay } from './textWidth.js';

describe('displayWidth', () => {
  const cases: { name: string; text: string; width: number }[] = [
    { name: 'ASCII is one cell per character', text: 'admin', width: 5 },
    { name: 'CJK is two cells per character', text: '見張り', width: 6 },
    { name: 'a mix adds up', text: 'web を立て直し', width: 3 + 1 + 10 },
    { name: 'fullwidth parentheses are two cells', text: '（既定）', width: 8 },
    { name: 'ANSI escapes do not count', text: '\u001b[32mup\u001b[0m', width: 2 },
    { name: 'the empty string is zero', text: '', width: 0 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(displayWidth(c.text)).toBe(c.width);
    });
  }
});

describe('padDisplay', () => {
  it('aligns a column that contains CJK by display width', () => {
    expect(padDisplay('見張り', 10)).toBe('見張り    ');
    expect(padDisplay('watch', 10)).toBe('watch     ');
  });

  it('adds nothing when the text is already wider', () => {
    expect(padDisplay('見張り', 2)).toBe('見張り');
  });
});

describe('clipDisplay', () => {
  it('leaves text that fits alone', () => {
    expect(clipDisplay('admin', 10)).toBe('admin');
  });

  it('cuts exactly, with no ellipsis', () => {
    expect(clipDisplay('あいう', 5)).toBe('あい');
    expect(displayWidth(clipDisplay('あいう', 5))).toBeLessThanOrEqual(5);
  });

  it('does not count colour towards the width, and closes it when cutting', () => {
    const colored = `\u001b[32mabcdef\u001b[0m`;
    expect(displayWidth(clipDisplay(colored, 3))).toBe(3);
    expect(clipDisplay(colored, 3).endsWith('\u001b[0m')).toBe(true);
  });

  it('never leaves a broken escape sequence behind', () => {
    expect(clipDisplay(`\u001b[31mあいう\u001b[0m`, 4)).toBe(`\u001b[31mあい\u001b[0m`);
  });
});

describe('truncateDisplay', () => {
  it('leaves text that fits alone', () => {
    expect(truncateDisplay('admin', 10)).toBe('admin');
  });

  it('ends with an ellipsis whose own width is inside the budget', () => {
    const cut = truncateDisplay('取り込みました', 8);
    expect(cut.endsWith('…')).toBe(true);
    expect(displayWidth(cut)).toBeLessThanOrEqual(8);
  });

  it('does not exceed the width when cutting inside wide characters', () => {
    // Three wide characters (6 cells) do not fit in 5. One cell goes to the ellipsis, so two
    // characters remain.
    expect(truncateDisplay('あいう', 5)).toBe('あい…');
  });

  it('degrades to the ellipsis alone, then to empty', () => {
    expect(truncateDisplay('あいう', 1)).toBe('…');
    expect(truncateDisplay('あいう', 0)).toBe('');
  });
});

describe('wrapDisplay', () => {
  it('returns a row that fits as a single row', () => {
    expect(wrapDisplay('admin', 10)).toEqual(['admin']);
  });

  it('carries the overflow to the next row rather than dropping it', () => {
    const rows = wrapDisplay('abcdefghij', 4);
    expect(rows).toEqual(['abcd', 'efgh', 'ij']);
    expect(rows.join('')).toBe('abcdefghij');
  });

  it('never exceeds the width, and never splits a wide character across rows', () => {
    const rows = wrapDisplay('あいうえお', 4);
    expect(rows).toEqual(['あい', 'うえ', 'お']);
    for (const r of rows) expect(displayWidth(r)).toBeLessThanOrEqual(4);
  });

  it('indents rows after the first, counting the indent towards the width', () => {
    expect(wrapDisplay('abcdefgh', 4, '  ')).toEqual(['abcd', '  ef', '  gh']);
  });

  it('closes and reopens colour per row so it does not bleed into the wrapped rows', () => {
    const rows = wrapDisplay(`\u001b[31mabcdef\u001b[0m`, 3);
    expect(rows).toEqual([`\u001b[31mabc\u001b[0m`, `\u001b[31mdef\u001b[0m`]);
    for (const r of rows) expect(displayWidth(r)).toBeLessThanOrEqual(3);
  });

  it('returns the text untouched when the width cannot hold anything', () => {
    expect(wrapDisplay('abcdef', 0)).toEqual(['abcdef']);
    expect(wrapDisplay('abcdef', 2, '  ')).toEqual(['abcdef']);
  });
});

describe('emoji width', () => {
  it('counts the wide islands in 2000-2FFF as two cells', () => {
    // ✨ U+2728, ❌ U+274C and ✅ U+2705 are EAW=Wide. Counting them as 1 shifts the right
    // border of the frame by one column.
    expect(displayWidth('✨')).toBe(2);
    expect(displayWidth('❌')).toBe(2);
    expect(displayWidth('✅')).toBe(2);
    expect(displayWidth('🌍')).toBe(2);
  });

  it('leaves EAW=Narrow symbols at one cell', () => {
    // ✓ U+2713, ▲ U+25B2 and ⚠ U+26A0 are all Narrow.
    expect(displayWidth('✓')).toBe(1);
    expect(displayWidth('▲')).toBe(1);
    expect(displayWidth('⚠')).toBe(1);
  });
});
