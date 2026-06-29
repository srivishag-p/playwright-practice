/**
 * SelfHealer — opt-in runtime recovery for failed locators.
 *
 * When a UI action throws because its locator no longer resolves, and
 * AI_SELF_HEAL=true, this asks the SimilarityEngine for the closest live-DOM
 * element, validates that the suggested locator resolves to exactly one node,
 * and hands it back so the action can be retried once.
 *
 * Safety:
 *   - Disabled by default. Only the AI_SELF_HEAL flag turns it on.
 *   - Heals only when the candidate's score clears AI_SELF_HEAL_MIN_SCORE
 *     (default 70) AND the suggested locator resolves to exactly one element.
 *   - Every heal is logged loudly with [SELF-HEAL] so it can never silently
 *     mask a real breakage — the run continues, but the log shows what changed.
 */

import type { Locator, Page } from 'playwright';
import { getEnvBool, getEnvNumber } from '@utils/env';
import { logger } from '@utils/logger';
import { SimilarityEngine } from './SimilarityEngine';
import { locatorFromString } from './locatorFromString';
import type { FailedAction } from './types';

export interface HealResult {
  /** The healed locator, validated to resolve to exactly one element. */
  locator: Locator;
  /** The suggested locator string (for logging / reporting). */
  suggested: string;
  /** SimilarityEngine score behind the suggestion. */
  score: number;
}

export class SelfHealer {
  static isEnabled(): boolean {
    return getEnvBool('AI_SELF_HEAL', false);
  }

  /**
   * Attempt to find a verified replacement for a failed locator. Returns
   * undefined when healing is disabled, no confident candidate exists, or the
   * candidate fails live-DOM validation. Never throws.
   */
  static async heal(page: Page, failed: Locator, description: string): Promise<HealResult | undefined> {
    if (!SelfHealer.isEnabled()) return undefined;

    const minScore = getEnvNumber('AI_SELF_HEAL_MIN_SCORE', 70);
    const selector = String(failed);

    try {
      const action: FailedAction = {
        stepText: description,
        action: 'unknown',
        description,
        selector,
        timestamp: new Date().toISOString(),
      };

      const candidates = await SimilarityEngine.findCandidates(page, action, 3);
      const top = candidates[0];
      if (!top || top.score < minScore) {
        logger.warn(
          `[SELF-HEAL] No confident candidate for "${description}" (selector ${selector}); ` +
            `best score ${top?.score ?? 0}% < ${minScore}%. Not healing.`
        );
        return undefined;
      }

      const locator = locatorFromString(page, top.suggestedLocator);
      if (!locator) {
        logger.warn(`[SELF-HEAL] Could not parse suggested locator "${top.suggestedLocator}". Not healing.`);
        return undefined;
      }

      // Validate against the live DOM — only heal on an unambiguous single match.
      const count = await locator.count();
      if (count !== 1) {
        logger.warn(
          `[SELF-HEAL] Suggested locator "${top.suggestedLocator}" resolved to ${count} elements ` +
            `(need exactly 1). Not healing.`
        );
        return undefined;
      }

      return { locator, suggested: top.suggestedLocator, score: top.score };
    } catch (err) {
      logger.warn(`[SELF-HEAL] Healing attempt errored: ${(err as Error).message}`);
      return undefined;
    }
  }
}
