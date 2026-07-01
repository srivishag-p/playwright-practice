/**
 * InteractionDiff — compares the previous successful element (from a stored
 * snapshot) against the current best candidate, producing a structured list of
 * what changed. This is the "what changed" engine behind the AI's changeAnalysis.
 *
 * Pure Node-side logic: no DOM, no DB. Reuses the shared levenshtein/string
 * similarity helpers so text comparisons match the rest of the engine.
 */

import { levenshtein, stringSimilarity } from './utils';
import type {
  DiffResult,
  FingerprintSummary,
  InteractionComparison,
  InteractionFingerprint,
} from './types';

export class InteractionDiff {
  /** Bounding-box overlap below this ratio is treated as "moved". */
  private static readonly MOVE_OVERLAP_THRESHOLD = 0.5;

  /** Reduce a full fingerprint to the compact summary sent to the AI / report. */
  static summarise(fp: InteractionFingerprint): FingerprintSummary {
    const parent = fp.parents[0];
    return {
      role: fp.a11y.role,
      accessibleName: fp.a11y.accessibleName,
      tag: fp.dom.tag,
      text: fp.dom.text,
      placeholder: fp.dom.placeholder,
      parentRole: parent?.role,
      parentName: parent?.accessibleName,
      semanticPath: fp.semanticPath,
    };
  }

  /**
   * Compare a previous fingerprint against the current one. Returns changes
   * ordered by severity (most significant first).
   */
  static compare(prev: InteractionFingerprint, curr: InteractionFingerprint): DiffResult[] {
    const changes: DiffResult[] = [];
    const push = (field: string, from?: string, to?: string, severity = 1) => {
      const f = from ?? '';
      const t = to ?? '';
      if (f === t) return;
      changes.push({ field, from: f, to: t, severity: Math.max(0, Math.min(1, severity)) });
    };

    // ── Accessibility ────────────────────────────────────────────────────────
    if ((prev.a11y.accessibleName ?? '') !== (curr.a11y.accessibleName ?? '')) {
      const sim = stringSimilarity(prev.a11y.accessibleName, curr.a11y.accessibleName);
      push('accessibleName', prev.a11y.accessibleName, curr.a11y.accessibleName, 1 - sim);
    }
    push('role', prev.a11y.role, curr.a11y.role, 0.9);

    // ── DOM ────────────────────────────────────────────────────────────────
    push('tag', prev.dom.tag, curr.dom.tag, 0.8);
    if ((prev.dom.placeholder ?? '') !== (curr.dom.placeholder ?? '')) {
      const sim = stringSimilarity(prev.dom.placeholder, curr.dom.placeholder);
      push('placeholder', prev.dom.placeholder, curr.dom.placeholder, 1 - sim);
    }
    if ((prev.dom.id ?? '') !== (curr.dom.id ?? '')) {
      const sim = stringSimilarity(prev.dom.id, curr.dom.id);
      push('id', prev.dom.id, curr.dom.id, 1 - sim);
    }
    if ((prev.dom.text ?? '') !== (curr.dom.text ?? '')) {
      const sim = stringSimilarity(prev.dom.text, curr.dom.text);
      // Visible-text drift is lower-signal than name/role — cap its severity.
      if (1 - sim > 0.15) push('text', prev.dom.text, curr.dom.text, (1 - sim) * 0.7);
    }
    push('name', prev.dom.name, curr.dom.name, 0.6);
    push('inputType', prev.dom.inputType, curr.dom.inputType, 0.5);

    // Removed/changed data-testid is high-signal for selector breakage.
    this.diffAttr(prev.dom.attributes, curr.dom.attributes, 'data-testid', changes);
    this.diffAttr(prev.dom.ariaAttributes, curr.dom.ariaAttributes, 'aria-label', changes);

    // ── Structure ─────────────────────────────────────────────────────────────
    const prevParent = prev.parents[0];
    const currParent = curr.parents[0];
    if ((prevParent?.accessibleName ?? '') !== (currParent?.accessibleName ?? '')) {
      const sim = stringSimilarity(prevParent?.accessibleName, currParent?.accessibleName);
      push('parentName',
        prevParent ? `${prevParent.role ?? prevParent.tag}(${prevParent.accessibleName ?? ''})` : '',
        currParent ? `${currParent.role ?? currParent.tag}(${currParent.accessibleName ?? ''})` : '',
        (1 - sim) * 0.7);
    }
    push('parentRole', prevParent?.role, currParent?.role, 0.5);

    const depthDelta = Math.abs(prev.position.domDepth - curr.position.domDepth);
    if (depthDelta > 0) {
      push('domDepth', String(prev.position.domDepth), String(curr.position.domDepth), Math.min(1, depthDelta / 4));
    }

    // ── Position ─────────────────────────────────────────────────────────────
    const overlap = this.overlapRatio(prev.position, curr.position);
    if (overlap < this.MOVE_OVERLAP_THRESHOLD) {
      push('position',
        `(${prev.position.x},${prev.position.y}) ${prev.position.width}×${prev.position.height}`,
        `(${curr.position.x},${curr.position.y}) ${curr.position.width}×${curr.position.height}`,
        (1 - overlap) * 0.4);
    }

    return changes.sort((a, b) => b.severity - a.severity);
  }

  /**
   * Build the full InteractionComparison bundle from a previous snapshot summary
   * and (optionally) a current fingerprint. When no current fingerprint exists
   * (nothing similar found in the live DOM), changes are empty and a note is set.
   */
  static buildComparison(input: {
    retrievalLevel: number;
    baselineDate?: string;
    previousFingerprint: InteractionFingerprint;
    previousScreenshotBase64?: string;
    currentFingerprint?: InteractionFingerprint;
    currentScreenshotBase64?: string;
    suggestedLocator?: string;
  }): InteractionComparison {
    const previous = this.summarise(input.previousFingerprint);
    const current = input.currentFingerprint ? this.summarise(input.currentFingerprint) : undefined;
    const detectedChanges = input.currentFingerprint
      ? this.compare(input.previousFingerprint, input.currentFingerprint)
      : [];

    const notes: string[] = [];
    if (input.retrievalLevel > 2) notes.push(`partial baseline match (level ${input.retrievalLevel})`);
    if (!input.currentFingerprint) notes.push('no current element resolved to compare against');

    return {
      retrievalLevel: input.retrievalLevel,
      baselineDate: input.baselineDate,
      previous,
      current,
      suggestedLocator: input.suggestedLocator,
      detectedChanges,
      previousScreenshotBase64: input.previousScreenshotBase64,
      currentScreenshotBase64: input.currentScreenshotBase64,
      note: notes.length ? notes.join('; ') : undefined,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private static diffAttr(
    prev: Record<string, string> | undefined,
    curr: Record<string, string> | undefined,
    key: string,
    out: DiffResult[]
  ): void {
    const p = prev?.[key];
    const c = curr?.[key];
    if ((p ?? '') === (c ?? '')) return;
    if (p && !c) out.push({ field: key, from: p, to: '', severity: 0.85 });
    else if (!p && c) out.push({ field: key, from: '', to: c, severity: 0.7 });
    else if (p && c) {
      const dist = levenshtein(p, c);
      out.push({ field: key, from: p, to: c, severity: dist <= 2 ? 0.6 : 0.85 });
    }
  }

  /** Intersection-over-union of two bounding boxes (0 = no overlap, 1 = identical). */
  private static overlapRatio(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ): number {
    const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const inter = ix * iy;
    const union = a.width * a.height + b.width * b.height - inter;
    return union <= 0 ? 1 : inter / union;
  }
}
