/**
 * FailureIntelligenceEngine — orchestrates the full pipeline when a scenario
 * fails and publishes the result to Allure.
 *
 *   1. Detect the failed action (step text + last recorded action + locator)
 *   2. Extract compact DOM intelligence for the failing element
 *   3. Collect supporting evidence (screenshot, logs, network, stack, env)
 *   4. Run the deterministic rule engine → ranked root causes
 *   5. Send the compact package to Gemini → AI analysis
 *   6. Attach named artifacts to Allure via world.attach (appear in Tear Down)
 *
 * Designed to never throw into the test lifecycle: any internal error is logged
 * and the hook continues so teardown still runs.
 */

import type { Locator, Page } from 'playwright';
import { FailureContext } from './FailureContext';
import { DomIntelligence } from './DomIntelligence';
import { EvidenceCollector } from './EvidenceCollector';
import { RuleEngine } from './RuleEngine';
import { SimilarityEngine } from './SimilarityEngine';
import { GeminiClient } from './GeminiClient';
import { ReportRenderer } from './ReportRenderer';
import { AutoPatch } from './AutoPatch';
import { locatorFromString } from './locatorFromString';
import { logger } from '@utils/logger';
import type { FailedAction, FailureIntelligencePackage, LocatorValidation, SelectorDiff, SimilarityCandidate } from './types';

/** Minimal surface the engine needs from the Cucumber World. */
export interface FailureWorldLike {
  page: Page;
  scenarioName: string;
  attach(
    data: Buffer | string,
    mediaTypeOrOptions?: string | { mediaType: string; fileName?: string }
  ): void | Promise<void>;
}

export class FailureIntelligenceEngine {
  static async run(world: FailureWorldLike, errorMessage: string): Promise<void> {
    try {
      const pkg = await FailureIntelligenceEngine.build(world, errorMessage ?? '');
      await FailureIntelligenceEngine.publish(world, pkg);
      const top = pkg.rankedRootCauses[0];
      logger.error(
        `AI Failure Intelligence ready for "${world.scenarioName}"` +
          (top ? ` — top cause: ${top.title} (${top.confidence}%)` : '')
      );
    } catch (err) {
      logger.warn(`Failure Intelligence Engine error: ${(err as Error).message}`);
    }
  }

  private static async build(
    world: FailureWorldLike,
    errorMessage: string
  ): Promise<FailureIntelligencePackage> {
    const ctx = FailureContext.for(world.page);

    const failingLocator = FailureIntelligenceEngine.resolveLocator(world.page, ctx, errorMessage);
    const failedAction: FailedAction = {
      stepText: ctx.currentStepText || world.scenarioName,
      action: ctx.lastAction?.type ?? (errorMessage.includes('expect(') ? 'assertion' : 'unknown'),
      description: ctx.lastAction?.description ?? ctx.currentStepText,
      selector: ctx.lastAction?.selector ?? FailureIntelligenceEngine.parseSelector(errorMessage),
      timestamp: ctx.lastAction?.timestamp ?? new Date().toISOString(),
    };

    const [dom, evidence] = await Promise.all([
      DomIntelligence.extract(world.page, failingLocator),
      EvidenceCollector.collect(world.page, errorMessage, failingLocator),
    ]);

    // Run similarity search only when the primary locator failed to resolve.
    const needsSimilarity = dom.matchCount === 0 || !dom.resolved;
    logger.debug(
      `[FIE] dom.matchCount=${dom.matchCount} dom.resolved=${dom.resolved} → needsSimilarity=${needsSimilarity} selector=${JSON.stringify(failedAction.selector)}`
    );
    const similarityCandidates = needsSimilarity
      ? await SimilarityEngine.findCandidates(world.page, failedAction)
      : [];

    const rankedRootCauses = RuleEngine.analyze({ failedAction, errorMessage, dom, evidence });

    // Build the selector diff before calling Gemini so the LLM receives a clean
    // "expected vs actual DOM" summary rather than raw HTML to reason over.
    const selectorDiff = FailureIntelligenceEngine.buildSelectorDiff(
      failedAction.selector,
      similarityCandidates,
    );

    // Validate the TOP candidates against the live page so the AI can pick the
    // best from real evidence (not just a fuzzy score). Each becomes a scored +
    // validated option; the headline is the top verified one (AI may re-pick).
    if (selectorDiff && similarityCandidates.length > 0) {
      const top = similarityCandidates.slice(0, 5);
      const candidates: import('./types').CandidateValidation[] = [];
      for (const c of top) {
        const v = await FailureIntelligenceEngine.validateLocator(world.page, c.suggestedLocator);
        candidates.push({
          locator: c.suggestedLocator,
          score: c.score,
          matchCount: v.matchCount,
          status: v.status,
          matchReasons: c.matchReasons,
        });
      }
      selectorDiff.candidates = candidates;

      // Headline = first candidate that resolves to exactly one element, else the
      // existing pre-computed (score-based) pick. Records its validation too.
      const verified = candidates.find((c) => c.status === 'verified');
      const headline = verified ?? candidates[0];
      selectorDiff.locatorValidation = {
        locator: headline.locator,
        matchCount: headline.matchCount,
        status: headline.status,
      };
      if (verified && !selectorDiff.preComputedLocator) {
        selectorDiff.preComputedLocator = verified.locator;
        selectorDiff.differenceHints.push(
          `Low-confidence guess verified against the live DOM — resolves to exactly 1 element: ${verified.locator}`
        );
      }

      // Annotate the screenshot for the headline locator when it resolves.
      if (headline.status === 'verified' || headline.status === 'ambiguous') {
        evidence.annotatedScreenshotBase64 =
          await FailureIntelligenceEngine.captureAnnotatedScreenshot(world.page, headline.locator);
      }
    }

    const ai = await GeminiClient.analyze({
      scenarioName: world.scenarioName,
      failedAction,
      errorMessage,
      dom,
      evidence,
      similarityCandidates,
      rankedRootCauses,
      selectorDiff,
    });

    // If the AI picked a different (verified) candidate as the best locator,
    // promote it to the headline so the report and patch reflect the AI's choice.
    if (ai.betterLocator && selectorDiff?.candidates) {
      const chosen = selectorDiff.candidates.find(
        (c) => c.locator === ai.betterLocator && c.status === 'verified'
      );
      if (chosen) selectorDiff.preComputedLocator = chosen.locator;
    }

    // Build a ready-to-apply source patch when we have a verified replacement.
    // Read-only: locates the failing locator in the page object and emits a diff.
    const patchSuggestion = await AutoPatch.suggest(
      failedAction.selector,
      selectorDiff?.preComputedLocator,
    );

    return { scenarioName: world.scenarioName, failedAction, errorMessage, dom, evidence, similarityCandidates, rankedRootCauses, selectorDiff, patchSuggestion, ai };
  }

  /** Attach named artifacts — appear as expandable steps inside Tear Down. */
  private static async publish(world: FailureWorldLike, pkg: FailureIntelligencePackage): Promise<void> {
    // ── 1. Main AI analysis report ──────────────────────────────────────────
    await world.attach(ReportRenderer.html(pkg), {
      mediaType: 'text/html',
      fileName: 'AI Failure Analysis',
    });

    // ── 2. Full-page screenshot ─────────────────────────────────────────────
    if (pkg.evidence.screenshotBase64) {
      await world.attach(Buffer.from(pkg.evidence.screenshotBase64, 'base64'), {
        mediaType: 'image/png',
        fileName: 'Screenshot (full page)',
      });
    }

    // ── 3. Element screenshot ───────────────────────────────────────────────
    if (pkg.evidence.elementScreenshotBase64) {
      await world.attach(Buffer.from(pkg.evidence.elementScreenshotBase64, 'base64'), {
        mediaType: 'image/png',
        fileName: 'Screenshot (element)',
      });
    }

    // ── 3b. Annotated screenshot — highlights the verified suggested target ──
    if (pkg.evidence.annotatedScreenshotBase64) {
      await world.attach(Buffer.from(pkg.evidence.annotatedScreenshotBase64, 'base64'), {
        mediaType: 'image/png',
        fileName: 'Screenshot (AI-annotated target)',
      });
    }



    // ── 5. DOM Context ──────────────────────────────────────────────────────
    if (pkg.dom.fingerprint || pkg.dom.domTree || pkg.dom.localWindow) {
      await world.attach(ReportRenderer.domHtml(pkg), {
        mediaType: 'text/html',
        fileName: 'DOM Context',
      });
    }

    // ── 6. Network Activity ─────────────────────────────────────────────────
    if (pkg.evidence.networkRequests.length > 0 || pkg.evidence.networkFailures.length > 0) {
      await world.attach(ReportRenderer.networkHtml(pkg), {
        mediaType: 'text/html',
        fileName: 'Network Activity',
      });
    }

    // ── 7. Console Logs ─────────────────────────────────────────────────────
    if (pkg.evidence.consoleLogs.length > 0) {
      await world.attach(ReportRenderer.consoleTxt(pkg), {
        mediaType: 'text/plain',
        fileName: 'Console Logs',
      });
    }

    // ── 8. Playwright Call Log ──────────────────────────────────────────────
    if (pkg.evidence.playwrightCallLog && pkg.evidence.playwrightCallLog.length > 0) {
      await world.attach(pkg.evidence.playwrightCallLog.join('\n'), {
        mediaType: 'text/plain',
        fileName: 'Playwright Call Log',
      });
    }

    // ── 9. Environment metadata ─────────────────────────────────────────────
    await world.attach(ReportRenderer.envJson(pkg), {
      mediaType: 'application/json',
      fileName: 'Environment',
    });

    // ── 10. Full intelligence package — comprehensive human-readable report ─
    await world.attach(ReportRenderer.packageReport(pkg), {
      mediaType: 'text/html',
      fileName: 'Failure Intelligence Package',
    });

    // ── 11. Whole DOM (complete page HTML) ───────────────────────────────────
    if (pkg.evidence.wholeDomHtml) {
      await world.attach(pkg.evidence.wholeDomHtml, {
        mediaType: 'text/html',
        fileName: 'Whole DOM',
      });
    }
  }

  private static resolveLocator(
    page: Page,
    ctx: FailureContext,
    errorMessage: string
  ): Locator | undefined {
    if (ctx.lastAction?.locator) return ctx.lastAction.locator;
    const selector = FailureIntelligenceEngine.parseSelector(errorMessage);
    if (!selector) return undefined;
    try {
      return page.locator(selector);
    } catch {
      return undefined;
    }
  }

  private static parseSelector(errorMessage: string): string | undefined {
    if (!errorMessage) return undefined;
    const m = errorMessage.match(/locator\((['"`])(.+?)\1\)/);
    if (m) return m[2];
    const s = errorMessage.match(/selector\s+["'`](.+?)["'`]/);
    return s ? s[1] : undefined;
  }

  // ── Locator validation ──────────────────────────────────────────────────────

  /**
   * Run a suggested locator string against the live page and report how many
   * elements it resolves to. This is what turns a scored guess into a verified
   * fix in the report. Never throws — failures are captured as status 'error'.
   */
  private static async validateLocator(page: Page, locatorStr: string): Promise<LocatorValidation> {
    try {
      const loc = locatorFromString(page, locatorStr);
      if (!loc) {
        return { locator: locatorStr, matchCount: -1, status: 'error', error: 'Unrecognised locator form — could not execute' };
      }
      const matchCount = await loc.count();
      const status: LocatorValidation['status'] =
        matchCount === 1 ? 'verified' : matchCount > 1 ? 'ambiguous' : 'unresolved';
      return { locator: locatorStr, matchCount, status };
    } catch (err) {
      return { locator: locatorStr, matchCount: -1, status: 'error', error: (err as Error).message };
    }
  }

  /**
   * Draw a highlight rectangle over every element the suggested locator resolves
   * to, then capture a full-page screenshot. Returns a base64 PNG, or undefined
   * on any failure (never throws into the pipeline). Overlays are injected as
   * absolutely-positioned DOM nodes at document coordinates so they line up with
   * the element in a full-page (scrolled) capture, and are removed afterwards.
   */
  private static async captureAnnotatedScreenshot(page: Page, locatorStr: string): Promise<string | undefined> {
    try {
      const loc = locatorFromString(page, locatorStr);
      if (!loc) return undefined;
      const handles = await loc.elementHandles();
      if (handles.length === 0) return undefined;

      const MARKER = '__aia_highlight__';
      for (let i = 0; i < handles.length; i++) {
        await handles[i].evaluate((el, args: { marker: string; index: number; total: number }) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const box = document.createElement('div');
          box.className = args.marker;
          box.style.cssText =
            `position:absolute;z-index:2147483647;pointer-events:none;` +
            `border:3px solid #ff3b30;background:rgba(255,59,48,0.12);border-radius:3px;` +
            `box-shadow:0 0 0 2px rgba(255,255,255,0.7);` +
            `left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
            `width:${r.width}px;height:${r.height}px;`;
          const label = document.createElement('div');
          label.textContent = args.total > 1
            ? `AI: suggested target ${args.index + 1}/${args.total}`
            : 'AI: suggested target';
          label.style.cssText =
            `position:absolute;top:-22px;left:0;background:#ff3b30;color:#fff;` +
            `font:600 11px/16px -apple-system,Segoe UI,sans-serif;padding:1px 6px;` +
            `border-radius:3px;white-space:nowrap;`;
          box.appendChild(label);
          document.body.appendChild(box);
        }, { marker: MARKER, index: i, total: handles.length });
      }

      const shot = await page.screenshot({ fullPage: true });

      await page.evaluate((marker) => {
        document.querySelectorAll('.' + marker).forEach((n) => n.remove());
      }, MARKER);
      for (const h of handles) await h.dispose();

      return shot.toString('base64');
    } catch {
      return undefined;
    }
  }

  // ── Selector diff ──────────────────────────────────────────────────────────

  /**
   * Build a structured diff between what the failing selector expected and what
   * the SimilarityEngine found in the live DOM. This is passed to Gemini instead
   * of raw HTML so the LLM has an explicit "expected vs actual" comparison.
   */
  private static buildSelectorDiff(
    selector: string | undefined,
    candidates: SimilarityCandidate[],
  ): SelectorDiff | undefined {
    if (!selector || candidates.length === 0) return undefined;

    const parsedTarget = FailureIntelligenceEngine.parseTargetFromSelector(selector);
    if (Object.keys(parsedTarget).length === 0) return undefined;

    const top = candidates[0];
    const hints: string[] = [];

    // Pre-computed locator is trusted when the similarity score is >= 60.
    const preComputedLocator = top.score >= 60 ? top.suggestedLocator : undefined;

    // Build a flat attribute map for the top candidate.
    const topCandidateAttributes: Record<string, string> = {};
    if (top.tag)         topCandidateAttributes.tag          = top.tag;
    if (top.id)          topCandidateAttributes.id           = top.id;
    if (top.role)        topCandidateAttributes.role         = top.role;
    if (top.ariaLabel)   topCandidateAttributes['aria-label'] = top.ariaLabel;
    if (top.placeholder) topCandidateAttributes.placeholder  = top.placeholder;
    if (top.dataTestId)  topCandidateAttributes['data-testid'] = top.dataTestId;
    if (top.text)        topCandidateAttributes.text         = top.text.slice(0, 80);

    // ── Compute human-readable difference hints ──────────────────────────────

    // id comparison — detect typos vs full renames
    if (parsedTarget.id) {
      if (top.id) {
        const dist = FailureIntelligenceEngine.levenshtein(parsedTarget.id, top.id);
        if (dist === 0) {
          hints.push(`id "${top.id}" matches exactly — failure is likely not a selector typo`);
        } else if (dist <= 3) {
          hints.push(`id has ${dist}-character typo: "${parsedTarget.id}" → "${top.id}"`);
        } else {
          hints.push(`id changed significantly: "${parsedTarget.id}" vs "${top.id}"`);
        }
      } else {
        hints.push(`No element with an id matching "${parsedTarget.id}" found in the DOM`);
      }
    }

    // data-testid comparison
    if (parsedTarget['data-testid']) {
      if (top.dataTestId) {
        const dist = FailureIntelligenceEngine.levenshtein(parsedTarget['data-testid'], top.dataTestId);
        if (dist > 0) {
          hints.push(`data-testid ${dist <= 2 ? 'typo' : 'renamed'}: "${parsedTarget['data-testid']}" → "${top.dataTestId}"`);
        }
      } else {
        hints.push(`data-testid "${parsedTarget['data-testid']}" not found — attribute may have been removed`);
      }
    }

    // tag mismatch
    if (parsedTarget.tag && top.tag && parsedTarget.tag !== top.tag) {
      hints.push(`Element tag changed: <${parsedTarget.tag}> → <${top.tag}>`);
    }

    // role mismatch
    if (parsedTarget.role && top.role && parsedTarget.role !== top.role) {
      hints.push(`role changed: "${parsedTarget.role}" → "${top.role}"`);
    }

    // Fallback: surface the match reasons from the similarity engine
    if (hints.length === 0) {
      hints.push(`Top DOM match (score ${top.score}%): ${top.matchReasons.join(', ')}`);
    }

    // When confidence is below the trust threshold we still want a usable
    // best-guess in the report rather than a dead end — surface the candidate
    // locator explicitly, clearly labelled as low-confidence.
    if (!preComputedLocator && top.suggestedLocator) {
      hints.push(
        `Best guess (low confidence, ${top.score}%): ${top.suggestedLocator} — verify against the live DOM before using.`
      );
    }

    return {
      failingSelector: selector,
      parsedTarget,
      preComputedLocator,
      topCandidateAttributes,
      differenceHints: hints,
    };
  }

  /** Extract locator-relevant attributes from a selector string (Node side). */
  private static parseTargetFromSelector(selector: string): Record<string, string> {
    const s = selector.trim();
    const result: Record<string, string> = {};

    const roleM = s.match(/getByRole\(['"`]([^'"`]+)['"`](?:\s*,\s*\{[^}]*\bname\s*:\s*['"`]([^'"`]+)['"`][^}]*\})?\)/);
    if (roleM) { result.role = roleM[1]; if (roleM[2]) result.accessibleName = roleM[2]; return result; }

    const phM = s.match(/getByPlaceholder\(['"`]([^'"`]+)['"`]\)/);
    if (phM) { result.placeholder = phM[1]; return result; }

    const labelM = s.match(/getByLabel\(['"`]([^'"`]+)['"`]\)/);
    if (labelM) { result['aria-label'] = labelM[1]; return result; }

    const textM = s.match(/getByText\(['"`]([^'"`]+)['"`]/);
    if (textM) { result.text = textM[1]; return result; }

    const titleM = s.match(/getByTitle\(['"`]([^'"`]+)['"`]\)/);
    if (titleM) { result.title = titleM[1]; return result; }

    const tidM = s.match(/getByTestId\(['"`]([^'"`]+)['"`]\)/);
    if (tidM) { result['data-testid'] = tidM[1]; return result; }

    // internal:role / internal:attr patterns (from String(locator))
    const iRoleM = s.match(/internal:role=([\w-]+)(?:\[name=["']?([^"'\]i]+)i?["']?\])?/);
    if (iRoleM) { result.role = iRoleM[1]; if (iRoleM[2]) result.accessibleName = iRoleM[2].trim(); return result; }

    // CSS selector (from locator('...') or raw CSS)
    let css = s
      .replace(/^(?:page\.)?locator\s*\(\s*/, '')
      .replace(/\s*\)\s*(?:\.first\(\)|\.last\(\)|\.nth\(\d+\))?\s*$/, '')
      .replace(/^(['"`])(.*)\1$/, '$2')
      .replace(/^css=/, '');

    if (css.startsWith('xpath=') || css.startsWith('//') || css.startsWith('(//')) return result;

    const tagM = css.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagM) result.tag = tagM[1].toLowerCase();

    const idM = css.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/);
    if (idM) result.id = idM[1];

    const attrRe = /\[([a-zA-Z][a-zA-Z0-9-]*)(?:=|~=|\*=|\$=|\^=)['"`]?([^'"`\]]+)['"`]?\]/g;
    for (const m of [...css.matchAll(attrRe)]) result[m[1]] = m[2].trim();

    return result;
  }

  /** Character-level edit distance used for typo detection in selector diffs. */
  private static levenshtein(a: string, b: string): number {
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
}
