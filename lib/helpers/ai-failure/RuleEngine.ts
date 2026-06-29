/**
 * RuleEngine — deterministic, evidence-based root-cause scoring.
 *
 * Runs BEFORE any AI call. Each candidate root cause is a set of weighted
 * evidence points; observed points (✓) add their weight, unobserved points (✗)
 * contribute nothing but are still shown so the reasoning is transparent. The raw
 * weighted score is mapped to a 0–99 confidence and candidates are ranked.
 *
 * These confidences are evidence-strength scores, NOT statistical probabilities.
 */

import type {
  DomIntelligenceResult,
  EvidencePoint,
  FailedAction,
  RootCauseCandidate,
  SupportingEvidence,
} from './types';

interface RuleInput {
  failedAction: FailedAction;
  errorMessage: string;
  dom: DomIntelligenceResult;
  evidence: SupportingEvidence;
}

export class RuleEngine {
  static analyze(input: RuleInput): RootCauseCandidate[] {
    const candidates = [
      RuleEngine.disabledElement(input),
      RuleEngine.loadingOverlay(input),
      RuleEngine.notVisible(input),
      RuleEngine.ambiguousLocator(input),
      RuleEngine.locatorNotFound(input),
      RuleEngine.detachedElement(input),
      RuleEngine.backendFailure(input),
      RuleEngine.assertionMismatch(input),
    ];

    return candidates
      .map((c) => RuleEngine.finalize(c))
      .filter((c) => c.rawScore > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Map a raw weighted score to a 0–99 confidence with mild saturation. */
  private static finalize(candidate: RootCauseCandidate): RootCauseCandidate {
    const raw = candidate.evidence.filter((e) => e.present).reduce((s, e) => s + e.weight, 0);
    // 100 raw → ~95; diminishing returns above so nothing reads as certain.
    const confidence = Math.min(99, Math.round(raw >= 100 ? 95 + (raw - 100) / 20 : raw * 0.95));
    return { ...candidate, rawScore: raw, confidence: Math.max(0, confidence) };
  }

  private static ev(label: string, present: boolean, weight: number): EvidencePoint {
    return { label, present, weight };
  }

  private static errIncludes(msg: string, ...needles: string[]): boolean {
    const lower = msg.toLowerCase();
    return needles.some((n) => lower.includes(n.toLowerCase()));
  }

  private static hasConsoleError(ev: SupportingEvidence, ...needles: string[]): boolean {
    return ev.consoleLogs.some(
      (c) =>
        (c.type === 'error' || c.type === 'pageerror') &&
        (needles.length === 0 || needles.some((n) => c.text.toLowerCase().includes(n.toLowerCase())))
    );
  }

  // ── Candidate rules ────────────────────────────────────────────────────────

  private static disabledElement({ errorMessage, dom, evidence }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    return {
      title: 'Target element is disabled',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('Element has a `disabled` attribute / state', dom.state?.disabled === true, 40),
        e('Playwright reports "element is not enabled"', RuleEngine.errIncludes(errorMessage, 'not enabled', 'is disabled'), 30),
        e('Element is rendered and visible', dom.state?.visible === true, 10),
        e('Client-side validation error in console', RuleEngine.hasConsoleError(evidence, 'valid', 'required'), 10),
        e('aria-disabled is set to true', dom.element?.ariaAttributes?.['aria-disabled'] === 'true', 10),
      ],
    };
  }

  private static loadingOverlay({ errorMessage, dom, evidence }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    const z = parseInt(dom.blockingOverlay?.zIndex ?? '', 10);
    return {
      title: 'A loading overlay is blocking the interaction',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('Overlay element detected covering the target', !!dom.blockingOverlay, 40),
        e('Playwright reports the click was intercepted', RuleEngine.errIncludes(errorMessage, 'intercepts pointer events', 'is not stable', 'subtree intercepts'), 30),
        e('Overlay sits on a high z-index', !Number.isNaN(z) && z >= 10, 15),
        e('No failing network activity (UI still settling)', evidence.networkFailures.length === 0, 10),
        e('Target element itself is enabled', dom.state?.enabled === true, 5),
      ],
    };
  }

  private static notVisible({ errorMessage, dom }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    const s = dom.styles;
    const hiddenByStyle = s?.display === 'none' || s?.visibility === 'hidden' || s?.opacity === '0';
    return {
      title: 'Element is present but not visible',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('Playwright reports "element is not visible"', RuleEngine.errIncludes(errorMessage, 'not visible'), 40),
        e('Computed style hides the element (display/visibility/opacity)', !!hiddenByStyle, 30),
        e('Element resolved in the DOM but state.visible is false', dom.resolved && dom.state?.visible === false, 20),
        e('pointer-events is disabled on the element', dom.styles?.pointerEvents === 'none', 10),
      ],
    };
  }

  private static ambiguousLocator({ errorMessage, dom }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    return {
      title: 'Locator is ambiguous (matches multiple elements)',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('Playwright reports a strict-mode violation', RuleEngine.errIncludes(errorMessage, 'strict mode violation', 'resolved to'), 45),
        e('Locator matched more than one element', dom.matchCount > 1, 35),
        e('Error references multiple candidate elements', RuleEngine.errIncludes(errorMessage, 'elements'), 10),
      ],
    };
  }

  private static locatorNotFound({ errorMessage, dom }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    return {
      title: 'Incorrect locator (element never found)',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('Locator resolved to zero elements', dom.matchCount === 0, 40),
        e('Timeout while waiting for the locator', RuleEngine.errIncludes(errorMessage, 'timeout', 'waiting for'), 30),
        e('No element handle could be obtained', dom.resolved === false && !!dom.error, 20),
      ],
    };
  }

  private static detachedElement({ errorMessage, dom }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    return {
      title: 'Element detached from the DOM during the action',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('Playwright reports the element is not attached', RuleEngine.errIncludes(errorMessage, 'not attached', 'detached'), 50),
        e('Element handle became stale during evaluation', !!dom.error && dom.error.includes('snapshot'), 20),
      ],
    };
  }

  private static backendFailure({ evidence }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    const has5xx = evidence.networkFailures.some((n) => (n.status ?? 0) >= 500);
    const has4xx = evidence.networkFailures.some((n) => (n.status ?? 0) >= 400 && (n.status ?? 0) < 500);
    return {
      title: 'Backend / API failure',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('A network request failed with a 5xx response', has5xx, 40),
        e('A network request failed with a 4xx response', has4xx, 25),
        e('One or more requests failed at the transport level', evidence.networkFailures.some((n) => !!n.failure), 20),
        e('Console reports an unhandled error', RuleEngine.hasConsoleError(evidence), 10),
      ],
    };
  }

  private static assertionMismatch({ failedAction, errorMessage }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    return {
      title: 'Assertion mismatch (actual ≠ expected)',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('Failure originated from an expect() assertion', failedAction.action === 'assertion' || RuleEngine.errIncludes(errorMessage, 'expect('), 40),
        e('Error shows an Expected/Received diff', RuleEngine.errIncludes(errorMessage, 'expected', 'received'), 25),
        e('No interaction-level error was reported', !RuleEngine.errIncludes(errorMessage, 'not enabled', 'not visible', 'intercepts', 'timeout'), 15),
      ],
    };
  }
}
