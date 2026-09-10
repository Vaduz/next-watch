// How the sections look (colour, wrapping, the cursor) is checked by assembling a panel; see
// `panel.test.ts`. What lives here is the formatting that is self-contained within a section.
import { describe, expect, it } from 'bun:test';
import { formatTokens } from './blocks.js';

describe('formatTokens', () => {
  const cases: { n: number | null; want: string }[] = [
    { n: null, want: '-' },
    { n: 940, want: '940' },
    { n: 305_072, want: '305k' },
    { n: 1_250_000, want: '1.3M' },
  ];
  for (const c of cases) {
    it(`${String(c.n)} -> ${c.want}`, () => {
      expect(formatTokens(c.n)).toBe(c.want);
    });
  }
});
