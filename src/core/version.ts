/** Ranking two version strings against each other. Pure, and **without a dependency**: the rules
 *  below are all of semver's precedence, which is less code than the smallest package that
 *  implements it.
 *
 *  What is compared has already had its prefix taken off — `parseReleaseTag` turns
 *  `rust-v0.155.1` into `0.155.1` before it ever reaches a row — so nothing here strips one. */

/** A version taken apart for ranking. Build metadata is not kept: semver gives it no place in
 *  precedence, so `1.0.0+build.7` and `1.0.0` are the same version. */
interface VersionParts {
  /** `0.155.1` as `[0, 155, 1]`. Missing places count as zero, so `1.0` ranks with `1.0.0`. */
  readonly release: readonly number[];
  /** The dot-separated identifiers after `-`, numbers where they are all digits. Empty for a
   *  release, which ranks **above** any prerelease of the same numbers. */
  readonly pre: readonly (string | number)[];
}

/** The whole string must be a version. Unlike `parseToolVersion`, which digs one out of a line of
 *  output, this refuses anything with the rest still attached — ranking half a string would be a
 *  guess, and a guess here installs software. */
const WHOLE_VERSION_RE = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** One dot-separated identifier: a number where it is all digits, the text otherwise. */
const identifier = (text: string): string | number => (/^\d+$/.test(text) ? Number(text) : text);

/** Take a version apart, or null when it is not one.
 *
 *  The pieces are cut by hand rather than read out of the match, because an optional group that
 *  did not participate is `undefined` at runtime while the types say `string`. */
function parseVersion(text: string): VersionParts | null {
  const trimmed = text.trim();
  if (!WHOLE_VERSION_RE.test(trimmed)) return null;
  const [core] = trimmed.split('+');
  const dash = core.indexOf('-');
  const releaseText = dash === -1 ? core : core.slice(0, dash);
  const preText = dash === -1 ? '' : core.slice(dash + 1);
  return {
    release: releaseText.split('.').map(Number),
    pre: preText === '' ? [] : preText.split('.').map(identifier),
  };
}

/** Rank one prerelease identifier against another: numbers as numbers, text as text, and a
 *  numeric identifier below an alphanumeric one. */
function compareIdentifier(left: string | number, right: string | number): -1 | 0 | 1 {
  if (left === right) return 0;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
  if (typeof left === 'number') return -1;
  if (typeof right === 'number') return 1;
  return left < right ? -1 : 1;
}

/** Rank the prerelease identifiers of two versions whose numbers are equal.
 *
 *  Semver's rules: a release outranks any prerelease, and where everything shared is equal, fewer
 *  identifiers rank below more (`1.0.0-alpha` is before `1.0.0-alpha.1`). */
function comparePre(a: VersionParts['pre'], b: VersionParts['pre']): -1 | 0 | 1 {
  if (a.length === 0 || b.length === 0) {
    if (a.length === b.length) return 0;
    return a.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareIdentifier(a[i], b[i]);
    if (order !== 0) return order;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * Rank two versions: negative when `a` is older, zero when they are the same version, positive
 * when `a` is newer. **Null when either one cannot be read as a version** — the caller decides
 * what to do about that, and no caller should install anything on the strength of it.
 *
 * `0.9.0` is older than `0.10.0`, which is the answer string comparison gets wrong; `1.0.0-alpha.3`
 * is older than `1.0.0`; `1.0.0+build` is neither older nor newer than `1.0.0`.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  for (let i = 0; i < Math.max(left.release.length, right.release.length); i++) {
    const l = left.release[i] ?? 0;
    const r = right.release[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return comparePre(left.pre, right.pre);
}
