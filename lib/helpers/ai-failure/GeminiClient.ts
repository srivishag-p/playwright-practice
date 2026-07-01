/**
 * GeminiClient — sends the compact Failure Intelligence Package to Google's
 * Generative Language API and returns a structured {@link AiAnalysis}.
 *
 * Deliberately dependency-free (Node's built-in https) so the framework doesn't
 * grow an SDK. Degrades gracefully: if no API key is set, the call is disabled,
 * or the request errors, it returns `available: false` and the rule-based report
 * is still produced.
 *
 * Config (environments/<env>.env):
 *   GEMINI_API_KEY        — required to enable AI analysis
 *   GEMINI_MODEL          — default "gemini-3.1-flash-lite"
 *   AI_FAILURE_ANALYSIS   — "false" to disable entirely
 *   GEMINI_TIMEOUT_MS     — default 20000
 */

import * as https from 'https';
import { logger } from '@utils/logger';
import { getEnv, getEnvBool, getEnvNumber } from '@utils/env';
import type {
  AiAnalysis,
  DomIntelligenceResult,
  FailedAction,
  InteractionComparison,
  RootCauseCandidate,
  SelectorDiff,
  SupportingEvidence,
} from './types';

interface GeminiInput {
  scenarioName: string;
  failedAction: FailedAction;
  errorMessage: string;
  dom: DomIntelligenceResult;
  evidence: SupportingEvidence;
  similarityCandidates: import('./types').SimilarityCandidate[];
  rankedRootCauses: RootCauseCandidate[];
  selectorDiff?: SelectorDiff;
  /** Old-vs-new comparison: last successful element state vs current DOM. */
  interactionComparison?: InteractionComparison;
}

export class GeminiClient {
  static isEnabled(): boolean {
    if (!getEnvBool('AI_FAILURE_ANALYSIS', true)) return false;
    return !!process.env.GEMINI_API_KEY;
  }

  static async analyze(input: GeminiInput): Promise<AiAnalysis> {
    if (!getEnvBool('AI_FAILURE_ANALYSIS', true)) {
      return { available: false, error: 'AI analysis disabled (AI_FAILURE_ANALYSIS=false)' };
    }
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return { available: false, error: 'GEMINI_API_KEY not set — skipping AI analysis' };
    }

    const model = getEnv('GEMINI_MODEL', 'gemini-3.1-flash-lite');
    const timeout = getEnvNumber('GEMINI_TIMEOUT_MS', 20000);

    try {
      const prompt = GeminiClient.buildPrompt(input);
      const raw = await GeminiClient.request(apiKey, model, prompt, timeout);
      return GeminiClient.parse(raw);
    } catch (err) {
      logger.warn(`Gemini analysis failed: ${(err as Error).message}`);
      return { available: false, error: (err as Error).message };
    }
  }

  /**
   * Build the prompt. Sends a compact, structured package — no raw HTML.
   *
   * Key design decisions:
   * - `selectorDiff` carries the pre-computed "expected vs actual DOM" comparison
   *   produced by FailureIntelligenceEngine before this call. Gemini's job is to
   *   *explain* that diff, not re-derive a locator from scratch.
   * - Only the fields the AI can reason over are sent. Fields that are purely for
   *   human report rendering (domTree, localWindow.children, full semanticSummary)
   *   are stripped here but remain in the package for ReportRenderer.
   * - `betterLocator` comes from `selectorDiff.preComputedLocator` (derived from
   *   the live DOM by SimilarityEngine). Gemini is told to use it verbatim — not
   *   to invent a different one.
   */
  private static buildPrompt(input: GeminiInput): string {
    const hasNetworkFailures = input.evidence.networkFailures.length > 0;
    const topRuleTitle       = input.rankedRootCauses[0]?.title ?? '';
    const isSelectorFailure  =
      topRuleTitle.toLowerCase().includes('locator') ||
      topRuleTitle.toLowerCase().includes('selector') ||
      topRuleTitle.toLowerCase().includes('ambiguous') ||
      topRuleTitle.toLowerCase().includes('not found') ||
      topRuleTitle.toLowerCase().includes('detached');

    // ── Build a trimmed DOM payload for the AI ────────────────────────────────
    // domTree is a multi-line text rendering — useful for humans, redundant for
    // the AI which already has fingerprint.path + ancestorChain.
    // localWindow.children and full semanticSummary add tokens without helping
    // with root-cause analysis; keep only siblings and a brief button/form list.
    const domForAi = {
      resolved:      input.dom.resolved,
      matchCount:    input.dom.matchCount,
      element:       input.dom.element,
      state:         input.dom.state,
      styles:        input.dom.styles,
      boundingBox:   input.dom.boundingBox,
      ancestorChain: input.dom.ancestorChain,
      a11y:          input.dom.a11y,
      fingerprint:   input.dom.fingerprint,
      blockingOverlay: input.dom.blockingOverlay,
      // Siblings help the AI understand ambiguity; children rarely do.
      localWindow: input.dom.localWindow
        ? { parent: input.dom.localWindow.parent, siblings: input.dom.localWindow.siblings }
        : undefined,
      // Trim semantic summary to the most diagnostic fields only.
      semanticSummary: input.dom.semanticSummary
        ? {
            pageTitle: input.dom.semanticSummary.pageTitle,
            buttons:   input.dom.semanticSummary.buttons.slice(0, 6),
            forms:     input.dom.semanticSummary.forms,
            dialogs:   input.dom.semanticSummary.dialogs,
          }
        : undefined,
      error: input.dom.error,
    };

    // Strip the (large) base64 screenshots from the comparison before sending —
    // the AI reasons over the structured diff; humans get the images in the report.
    const ic = input.interactionComparison;
    const comparisonForAi = ic
      ? {
          retrievalLevel: ic.retrievalLevel,
          baselineDate: ic.baselineDate,
          previous: ic.previous,
          current: ic.current,
          suggestedLocator: ic.suggestedLocator,
          detectedChanges: ic.detectedChanges,
          note: ic.note,
          elementGone: ic.elementGone,
        }
      : undefined;

    const slim = {
      scenario: input.scenarioName,
      failedAction: input.failedAction,
      errorMessage: input.errorMessage.slice(0, 2000),
      dom: domForAi,
      // Pre-computed diff: what the selector expected vs what the DOM has.
      // differenceHints describes the specific gap (typo, rename, moved, missing attr).
      selectorDiff: input.selectorDiff,
      // Old info vs new info: last successful element state vs current best candidate.
      interactionComparison: comparisonForAi,
      consoleLogs: input.evidence.consoleLogs,
      networkFailures: input.evidence.networkFailures,
      playwrightCallLog: input.evidence.playwrightCallLog,
      browser: input.evidence.browser,
      rankedRootCauses: input.rankedRootCauses.map((c) => ({
        title: c.title,
        confidence: c.confidence,
        evidence: c.evidence.filter((e) => e.present).map((e) => e.label),
      })),
    };

    logger.info(`[GeminiClient] Package sent to AI:\n${JSON.stringify(slim, null, 2)}`);

    return [
      'You are a senior principal test-automation and quality-assurance engineer analysing a failed Playwright + Cucumber UI test.',
      'A deterministic rule engine has already analyzed the failure and ranked candidate root causes with evidence-based confidence scores.',
      '',
      '## GROUND RULE — evidence-only output',
      'Every field MUST be derived directly from the failure package. Do NOT invent fixes, locators, or causes not evidenced in the data.',
      'If evidence for a field is absent, output [] or "" — never fabricate plausible-sounding content.',
      '',
      '## betterLocator — CHOOSE the best from the validated candidate list',
      (input.selectorDiff?.candidates && input.selectorDiff.candidates.length > 0)
        ? [
            'selectorDiff.candidates is a ranked list of locators the SimilarityEngine derived from the LIVE DOM. Each was executed against the page, so you have real evidence:',
            '  - status="verified" → resolves to exactly 1 element (BEST — strongly prefer these)',
            '  - status="ambiguous" → resolves to >1 (usable only with an extra filter)',
            '  - status="unresolved"/"error" → does not work (do NOT choose)',
            'Selection rules for betterLocator (in order):',
            '  1. Among status="verified", pick the most resilient/user-facing one',
            '     (getByTestId > getByRole+name > getByLabel > getByPlaceholder > #id > css).',
            '  2. If none are verified, pick the highest-score "ambiguous" and note it needs refining.',
            '  3. Copy the chosen candidate.locator VERBATIM — do not invent or edit it.',
            'Set betterLocatorReason to one sentence explaining why you chose it over the others.',
            'Set candidateAssessments to a one-line note for EACH candidate (why it is good or rejected).',
          ].join('\n')
        : [
            'No DOM candidates were found. Derive betterLocator ONLY from these fields (priority order):',
            '  1. dom.element.dataAttributes["data-testid"] → page.getByTestId("<value>")',
            '  2. dom.a11y.label or dom.element.ariaAttributes["aria-label"] → page.getByLabel("<value>")',
            '  3. dom.a11y.role + dom.a11y.name → page.getByRole("<role>", { name: "<name>" })',
            '  4. dom.element.ariaAttributes["placeholder"] → page.getByPlaceholder("<value>")',
            '  5. dom.fingerprint.path + dom.element.id (stable id only) → page.locator("#<id>")',
            'Output "" if none of these fields contain usable values. candidateAssessments MUST be [].',
          ].join('\n'),
      '',
      '## selectorDiff — use this to explain the root cause',
      'The selectorDiff field shows exactly what the failing selector expected vs what the DOM actually has.',
      'Use selectorDiff.differenceHints as the primary evidence for your rootCause and explanation.',
      'Example: if differenceHints says "id has 1-character typo: \'NewAcount\' → \'NewAccount\'", your rootCause should state the typo explicitly.',
      '',
      '## interactionComparison — what changed since this locator last worked',
      input.interactionComparison?.elementGone
        ? [
            '⚠️  ELEMENT REMOVED — DB-FIRST PRIORITY RULE:',
            'interactionComparison.elementGone = true means the database has a confirmed baseline for this',
            'exact locator (captured ' + (input.interactionComparison.baselineDate ?? 'previously') + ') but the element does NOT exist',
            'anywhere in the current DOM. A section of the UI was removed or the element was deleted.',
            '',
            'You MUST follow these rules:',
            '  1. Set betterLocator to "" — do NOT suggest any replacement locator. There is nothing to replace.',
            '  2. Set candidateAssessments to [] — no candidates are relevant.',
            '  3. Set changeAnalysis.whatChanged to describe the element that was removed (use interactionComparison.previous to name it).',
            '  4. Set changeAnalysis.whyCausedFailure to state the element / section no longer exists in the DOM.',
            '  5. Set changeAnalysis.fix to "" — the fix is an APPLICATION change (restore the removed element), not an automation change.',
            '  6. Set rootCause to clearly state the element was removed from the UI.',
            '  7. Set issueClassification to "Application Bug".',
          ].join('\n')
        : input.interactionComparison
          ? [
              'interactionComparison is the OLD-vs-NEW evidence: the element state the LAST time this locator',
              'successfully acted (interactionComparison.previous, captured ' + (input.interactionComparison.baselineDate ?? 'previously') + ')',
              'vs the current best DOM candidate (interactionComparison.current).',
              'interactionComparison.detectedChanges lists every measured difference (field, from, to, severity).',
              'retrievalLevel indicates how closely the baseline matches (1 = exact; >2 = partial — say so).',
              'Produce a changeAnalysis object:',
              '  - whatChanged:      the specific field(s) that changed — quote detectedChanges from/to values',
              '  - whyCausedFailure: why that change made THIS locator (failedAction.selector) stop matching',
              '  - fix:              the exact updated locator — MUST equal betterLocator',
              'When detectedChanges is empty but a baseline exists, the element likely moved or was removed —',
              'state that rather than inventing a field change.',
            ].join('\n')
          : 'No prior successful snapshot was available for this locator. Set changeAnalysis to null and do not speculate about what changed.',
      '',
      '## appFixes — only when network/console evidence is present',
      isSelectorFailure && !hasNetworkFailures
        ? 'The top rule-engine candidate is a selector/locator failure with no network failures. appFixes MUST be []. Do NOT suggest server config, MIME types, 404 fixes, or deployment steps.'
        : 'Only populate appFixes when networkFailures or consoleLogs contain direct evidence of an application-side problem. Each fix must quote the specific URL, HTTP status, or log message that motivated it.',
      '',
      '## automationImprovements — cite specific DOM attributes',
      'Reference failedAction.selector and selectorDiff.parsedTarget. Each improvement must name the specific attribute from dom.element or selectorDiff.topCandidateAttributes it is based on.',
      '',
      'Return a STRICT JSON object (do NOT wrap in ```json fences):',
      '{',
      '  "rootCause": string,           // specific cause — cite selectorDiff.differenceHints, console log text, or DOM field values',
      '  "confidence": number,          // 0–100',
      '  "confidenceLevel": string,     // "Low" | "Medium" | "High" | "Very High"',
      '  "alternativeCauses": [{ "cause": string, "confidence": number }],',
      '  "timeline": string[],          // chronological events from networkRequests, consoleLogs, and action records',
      '  "explanation": string,         // detailed explanation — cite selectorDiff.differenceHints and DOM/log evidence',
      '  "issueClassification": string, // "Selector Mismatch" | "Race Condition" | "Application Bug" | "Environment/MIME Issue" | "Network/API Timeout" | "Other"',
      '  "rootCauseCategory": string,   // "Automation" | "Application" | "Environment"',
      '  "isFlaky": boolean,',
      '  "betterLocator": string,       // the chosen candidate.locator (verbatim), or "" — see rules above',
      '  "betterLocatorReason": string, // one sentence: why this candidate over the others',
      '  "candidateAssessments": [{ "locator": string, "note": string }], // one note per candidate',
      '  "appFixes": string[],          // [] for selector failures; each item quotes its evidence source',
      '  "automationImprovements": string[], // each item cites a specific DOM attribute from the package',
      '  "stabilityRecommendations": string[],',
      '  "debuggingChecklist": string[],',
      '  "scoreExplanations": { [rootCauseTitle: string]: string },',
      '  "changeAnalysis": { "whatChanged": string, "whyCausedFailure": string, "fix": string } | null',
      '}',
      '',
      'Failure package:',
      JSON.stringify(slim),
    ].join('\n');
  }

  private static request(apiKey: string, model: string, prompt: string, timeoutMs: number): Promise<string> {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    });

    const options: https.RequestOptions = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs,
    };

    return new Promise<string>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Gemini API ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) {
              reject(new Error('Gemini response contained no text'));
              return;
            }
            resolve(text);
          } catch (e) {
            reject(new Error(`Could not parse Gemini response: ${(e as Error).message}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`Gemini request timed out after ${timeoutMs}ms`));
      });
      req.write(body);
      req.end();
    });
  }

  /** Parse the model's JSON text into a structured analysis (lenient). */
  private static parse(raw: string): AiAnalysis {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      const obj = JSON.parse(cleaned);
      return {
        available: true,
        rootCause: obj.rootCause,
        explanation: obj.explanation,
        confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
        // Derive the label deterministically from the score so it can never
        // contradict the number (the model sometimes mislabels, e.g. 86% "Very High").
        confidenceLevel: typeof obj.confidence === 'number'
          ? GeminiClient.levelFor(obj.confidence)
          : (typeof obj.confidenceLevel === 'string' ? obj.confidenceLevel : undefined),
        alternativeCauses: Array.isArray(obj.alternativeCauses) ? obj.alternativeCauses.map((ac: any) => ({
          cause: String(ac.cause || ac.causeDescription || ''),
          confidence: typeof ac.confidence === 'number' ? ac.confidence : 0
        })) : undefined,
        timeline: GeminiClient.toArray(obj.timeline),
        appFixes: GeminiClient.toArray(obj.appFixes),
        automationImprovements: GeminiClient.toArray(obj.automationImprovements),
        betterLocator: obj.betterLocator || undefined,
        betterLocatorReason: typeof obj.betterLocatorReason === 'string' ? obj.betterLocatorReason : undefined,
        candidateAssessments: Array.isArray(obj.candidateAssessments)
          ? obj.candidateAssessments
              .filter((a: any) => a && a.locator)
              .map((a: any) => ({ locator: String(a.locator), note: String(a.note || '') }))
          : undefined,
        stabilityRecommendations: GeminiClient.toArray(obj.stabilityRecommendations),
        issueClassification: obj.issueClassification,
        rootCauseCategory: obj.rootCauseCategory,
        isFlaky: typeof obj.isFlaky === 'boolean' ? obj.isFlaky : undefined,
        debuggingChecklist: GeminiClient.toArray(obj.debuggingChecklist),
        scoreExplanations: typeof obj.scoreExplanations === 'object' ? obj.scoreExplanations : undefined,
        changeAnalysis: obj.changeAnalysis && typeof obj.changeAnalysis === 'object'
          ? {
              whatChanged: typeof obj.changeAnalysis.whatChanged === 'string' ? obj.changeAnalysis.whatChanged : undefined,
              whyCausedFailure: typeof obj.changeAnalysis.whyCausedFailure === 'string' ? obj.changeAnalysis.whyCausedFailure : undefined,
              fix: typeof obj.changeAnalysis.fix === 'string' ? obj.changeAnalysis.fix : undefined,
            }
          : undefined,
      };
    } catch {
      // Model didn't return clean JSON — keep the prose so nothing is lost.
      return { available: true, raw: cleaned };
    }
  }

  /** Deterministic confidence band from a 0–100 score (overrides the model's label). */
  private static levelFor(n: number): string {
    if (n >= 90) return 'Very High';
    if (n >= 75) return 'High';
    if (n >= 50) return 'Medium';
    return 'Low';
  }

  private static toArray(v: unknown): string[] | undefined {
    if (Array.isArray(v)) return v.map((x) => String(x));
    if (typeof v === 'string' && v.trim()) return [v];
    return undefined;
  }
}
