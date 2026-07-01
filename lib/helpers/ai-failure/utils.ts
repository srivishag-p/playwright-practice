/**
 * Shared helpers for the AI Failure Intelligence engine.
 *
 * Kept dependency-free so both Node-side modules (FailureIntelligenceEngine,
 * InteractionDiff) and lightweight call sites can import without pulling in the
 * browser-context code.
 */

/** Character-level edit distance — used for typo / rename detection. */
export function levenshtein(a: string, b: string): number {
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

/**
 * Normalised similarity 0–1 between two strings, derived from edit distance.
 * 1 = identical, 0 = completely different. Empty/empty counts as identical.
 */
export function stringSimilarity(a?: string, b?: string): number {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  const dist = levenshtein(x, y);
  return 1 - dist / Math.max(x.length, y.length);
}

/** Slugify a URL into a stable key (drops query/hash noise but keeps path). */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
