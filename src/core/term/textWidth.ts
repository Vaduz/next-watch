/** Measure and align text by the width it takes on a terminal, not by `String#length`.
 *
 *  The dashboard puts session names and repository names in the same table, and a session
 *  name can be CJK. A CJK character occupies two cells, so aligning on `.length` makes the
 *  columns to its right step out of line. This module holds the width arithmetic and nothing
 *  else.
 *
 *  The set counted as width 2 lists the representative blocks of East Asian Wide and
 *  Fullwidth (Unicode EAW W and F). Handling variation selectors and combining marks exactly
 *  is not what aligning a table needs, so this stays **an approximation good enough that the
 *  frame does not break**.
 */

/** Code point ranges counted as width 2 (both ends inclusive). */
const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals and kana punctuation
  [0x3041, 0x33ff], // Kana, Hangul and CJK symbols
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi syllables
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe6f], // Vertical forms and small form variants
  [0xff00, 0xff60], // Fullwidth alphanumerics and punctuation
  [0xffe0, 0xffe6], // Fullwidth currency signs
  // EAW=Wide emoji scattered through 2000-2FFF. They are **islands, not a range**, so each
  // one is listed (a tool that prints `✨` or `❌` lands here; counting them as 1 pushes the
  // right border of the frame one column out of place).
  // ⚠ (U+26A0) is EAW=Narrow and is deliberately absent: terminals draw it as 1 or 2.
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x1f300, 0x1f9ff], // Emoji (most terminals draw these in two cells)
  [0x20000, 0x3fffd], // CJK Extension B and beyond
];

/** ANSI escapes (colour) occupy no cells, so they are dropped before measuring. */

const ANSI = /\u001b\[[0-9;]*m/g;

/** Display width of one code point (0, 1 or 2). */
function charWidth(code: number): number {
  // Combining marks, variation selectors and ZWJ sit on the preceding character, so they
  // have no width of their own.
  if (code >= 0x0300 && code <= 0x036f) return 0;
  if (code === 0xfe0f || code === 0x200d) return 0;
  return WIDE_RANGES.some(([lo, hi]) => code >= lo && code <= hi) ? 2 : 1;
}

/** Cells the text occupies on a terminal. Coloured text measures correctly. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text.replace(ANSI, '')) width += charWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/** Pad on the right to a display width (returns the text unchanged if it is already wider). */
export function padDisplay(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}

/** Cut at **exactly** a display width. No ellipsis, and colour is not broken.
 *
 *  This is the last line of defence for the right border of the frame. Cell contents are
 *  already trimmed to each column's budget, but a single unexpectedly long line pushes the
 *  right border out and the frame collapses. Colour (ANSI escapes) is carried through without
 *  counting towards the width, and a cut in the middle closes the colour. */
export function clipDisplay(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = '';
  let used = 0;
  let colored = false;
  for (let i = 0; i < text.length;) {
    if (text.startsWith('\u001b[', i)) {
      const end = text.indexOf('m', i);
      if (end === -1) break;
      const code = text.slice(i, end + 1);
      colored = code !== '\u001b[0m';
      out += code;
      i = end + 1;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    const w = charWidth(ch.codePointAt(0) ?? 0);
    if (used + w > width) break;
    out += ch;
    used += w;
    i += ch.length;
  }
  return colored ? `${out}\u001b[0m` : out;
}

/** Truncate to a display width, ending with `…` when something was cut (the ellipsis's own
 *  width is part of the budget). */
export function truncateDisplay(text: string, width: number): string {
  if (width <= 0) return '';
  if (displayWidth(text) <= width) return text;
  if (width === 1) return '…';
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}

/** **Wrap** at a display width instead of cutting. Text that fits comes back as one row.
 *
 *  Breaks land **exactly on the width**, not on word boundaries. What overflows here is paths,
 *  URLs and error messages — mostly long runs with no spaces in them, so breaking on words
 *  would overflow anyway.
 *
 *  Colour (ANSI escapes) does not count towards the width and is **closed at the end of a row
 *  and reopened on the next**; without that the colour bleeds into the wrapped rows. `indent`
 *  is placed at the head of every row after the first (an event row indents by the width of
 *  the timestamp so the text lines up). */
export function wrapDisplay(text: string, width: number, indent = ''): string[] {
  if (width <= 0 || displayWidth(indent) >= width) return [text];
  if (displayWidth(text) <= width) return [text];
  const rows: string[] = [];
  let open = '';
  let out = '';
  let used = 0;
  const close = (line: string): string => (open === '' ? line : `${line}\u001b[0m`);
  const wrap = (): void => {
    rows.push(close(out));
    out = `${indent}${open}`;
    used = displayWidth(indent);
  };
  for (let i = 0; i < text.length;) {
    if (text.startsWith('\u001b[', i)) {
      const end = text.indexOf('m', i);
      if (end === -1) break;
      const code = text.slice(i, end + 1);
      open = code === '\u001b[0m' ? '' : code;
      out += code;
      i = end + 1;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    const w = charWidth(ch.codePointAt(0) ?? 0);
    if (used + w > width) wrap();
    out += ch;
    used += w;
    i += ch.length;
  }
  if (displayWidth(out) > displayWidth(indent)) rows.push(close(out));
  return rows;
}

/** Join cells into one row at fixed widths: each cell is truncated to its width, cells are
 *  separated by two spaces, and the row is right-trimmed. This is what lets a CJK title and an
 *  ASCII URL sit in the same table without the columns stepping. */
export function padRow(cells: readonly (readonly [string, number])[]): string {
  return cells
    .map(([s, w]) => padDisplay(truncateDisplay(s, w), w))
    .join('  ')
    .trimEnd();
}
