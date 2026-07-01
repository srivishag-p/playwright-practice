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
  SimilarityCandidate,
  SupportingEvidence,
} from './types';

interface RuleInput {
  failedAction: FailedAction;
  errorMessage: string;
  dom: DomIntelligenceResult;
  evidence: SupportingEvidence;
  /** Top candidates from SimilarityEngine — available before locator validation. */
  similarityCandidates?: SimilarityCandidate[];
}

/**
 * Returns true for transport-level failures that are genuinely caused by
 * connectivity (connection refused, reset, DNS failure, etc.).
 * Excludes net::ERR_ABORTED — that is the browser cancelling a request
 * (navigation away, prefetch abort, analytics beacon), not a connectivity issue.
 */
function isRealTransportFailure(failureText: string): boolean {
  const t = failureText.toLowerCase();
  return !t.includes('aborted') && !t.includes('err_aborted');
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
      RuleEngine.networkConnectivityFailure(input),
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

  private static locatorNotFound({ errorMessage, dom, evidence, failedAction, similarityCandidates }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    const hasNetworkFailures = evidence.networkFailures.length > 0;
    const isElementAction = failedAction.action !== 'navigate';
    // A high-confidence similarity candidate (score ≥ 60) means the element WAS found
    // in the DOM under a different selector — definitive proof the locator strategy is
    // wrong, not that the element is absent due to a network or rendering issue.
    const topCandidate = similarityCandidates?.[0];
    const elementFoundByAlternative = (topCandidate?.score ?? 0) >= 60;
    return {
      title: 'Incorrect locator (element never found)',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('Locator resolved to zero elements', dom.matchCount === 0, 40),
        // Only count timeout as locator evidence when there are no network failures —
        // a connectivity issue causes the same timeout but for a different reason.
        e('Timeout while waiting for the locator (no network failures present)', RuleEngine.errIncludes(errorMessage, 'timeout', 'waiting for') && !hasNetworkFailures, 30),
        e('No element handle could be obtained', dom.resolved === false && !!dom.error, 20),
        // An element interaction (click/fill/etc.) implies the page loaded successfully —
        // a timeout here means the element itself is the problem, not a missing page.
        e('Failed action was an element interaction, not a page navigation (page was already loaded)', isElementAction, 15),
        // Strongest locator-mismatch signal: SimilarityEngine found the element in the
        // DOM under a different selector. The element EXISTS — the strategy is wrong.
        e('SimilarityEngine found a high-confidence alternative locator — element exists in DOM, locator strategy is wrong', elementFoundByAlternative, 35),
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

  private static networkConnectivityFailure({ errorMessage, evidence, failedAction }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    // Exclude ERR_ABORTED — that is the browser cancelling a request (prefetch,
    // navigation away, telemetry beacon), not a real connectivity failure.
    const hasRealTransportFailure = evidence.networkFailures.some((n) => !!n.failure && isRealTransportFailure(n.failure));
    const hasNetworkFailures = evidence.networkFailures.length > 0;
    const isNavigateAction = failedAction.action === 'navigate';
    return {
      title: 'Network / connectivity failure',
      confidence: 0,
      rawScore: 0,
      evidence: [
        // Real transport-level failures only (connection refused/reset/DNS failure).
        // ERR_ABORTED is excluded — it is the browser cancelling a request, not the
        // server being unreachable.
        e('One or more requests failed at the transport level (connection refused/reset/DNS — not browser-aborted)', hasRealTransportFailure, 55),
        e('Error message contains a network error code (net::ERR_*, NS_ERROR_*, ERR_CONNECTION_*)', RuleEngine.errIncludes(errorMessage, 'net::err', 'ns_error', 'err_connection', 'err_network', 'err_timed_out', 'failed to fetch', 'network error'), 30),
        e('Timeout in the error while network failures are present', RuleEngine.errIncludes(errorMessage, 'timeout') && hasNetworkFailures, 20),
        // A navigation action failing alongside network errors is a strong signal the
        // page itself was unreachable — not an element locator problem.
        e('Failed action was a page navigation (page itself may not have loaded)', isNavigateAction && hasNetworkFailures, 20),
        e('Console error logged alongside network failures', RuleEngine.hasConsoleError(evidence) && hasNetworkFailures, 10),
      ],
    };
  }

  private static backendFailure({ evidence }: RuleInput): RootCauseCandidate {
    const e = RuleEngine.ev;
    const has5xx = evidence.networkFailures.some((n) => (n.status ?? 0) >= 500);
    const has4xx = evidence.networkFailures.some((n) => (n.status ?? 0) >= 400 && (n.status ?? 0) < 500);
    // Real transport failures only — ERR_ABORTED is a browser-cancelled request
    // (telemetry, prefetch) and should not count as a backend failure.
    const hasRealTransportFailure = evidence.networkFailures.some((n) => !!n.failure && isRealTransportFailure(n.failure));
    return {
      title: 'Backend / API failure',
      confidence: 0,
      rawScore: 0,
      evidence: [
        e('A network request failed with a 5xx response', has5xx, 40),
        e('A network request failed with a 4xx response', has4xx, 25),
        e('One or more requests failed at the transport level (not browser-aborted)', hasRealTransportFailure, 20),
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
