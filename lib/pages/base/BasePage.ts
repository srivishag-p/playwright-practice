import { Page, Locator, expect } from '@playwright/test';
import { logger } from '@utils/logger';
import { FailureContext, SelfHealer, InteractionSnapshotCapture } from '@helpers/ai-failure';
import type { ActionType } from '@helpers/ai-failure';

export abstract class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  abstract readonly url: string;
  abstract isLoaded(): Promise<boolean>;

  /** Record the action about to run so the Failure Intelligence Engine can use it. */
  protected track(type: ActionType, description: string, locator?: Locator, value?: string): void {
    FailureContext.for(this.page).recordAction({
      type,
      description,
      locator,
      selector: locator ? String(locator) : undefined,
      value,
    });
  }

  async navigate(path?: string): Promise<void> {
    const target = path ?? this.url;
    this.track('navigate', `Navigate to ${target}`);
    logger.info(`Navigating to: ${target}`);
    await this.page.goto(target);
    await this.waitForPageLoad();
  }

  async waitForPageLoad(state: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<void> {
    await this.page.waitForLoadState(state);
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  /**
   * Run a locator-based action, and — when AI_SELF_HEAL=true — retry it once with
   * an AI-suggested, live-DOM-verified locator if the original fails. Disabled by
   * default; when on, every recovery is logged loudly with [SELF-HEAL] so a real
   * breakage is never silently masked. When healing is off or finds no confident
   * replacement, the original error propagates unchanged.
   */
  private async withHealing(
    type: ActionType,
    description: string,
    locator: Locator,
    run: (loc: Locator) => Promise<void>
  ): Promise<void> {
    try {
      await run(locator);
      await this.captureSnapshot(type, locator);
    } catch (err) {
      const healed = await SelfHealer.heal(this.page, locator, description);
      if (!healed) throw err;
      logger.warn(
        `[SELF-HEAL] "${description}": ${String(locator)} failed — ` +
          `retrying with ${healed.suggested} (score ${healed.score}%)`
      );
      // Re-track so a later failure reflects the locator that actually ran.
      this.track(type, `${description} (self-healed → ${healed.suggested})`, healed.locator);
      await run(healed.locator);
      await this.captureSnapshot(type, healed.locator);
    }
  }

  /**
   * Record an Interaction Snapshot for a locator that just acted successfully.
   * Drives the "old info vs new info" UI-change analysis when this locator later
   * fails. No-op (and zero browser work) when the interaction store is disabled
   * or unavailable; never throws into the action path.
   */
  private async captureSnapshot(type: ActionType, locator: Locator): Promise<void> {
    const ctx = FailureContext.for(this.page);
    await InteractionSnapshotCapture.capture(this.page, locator, {
      scenarioName: ctx.scenarioName || 'unknown scenario',
      stepText: ctx.currentStepText || '',
      actionType: type,
    });
  }

  protected async click(locator: Locator, description?: string): Promise<void> {
    const desc = description ?? 'element';
    this.track('click', `Click ${desc}`, locator);
    logger.debug(`Click: ${desc}`);
    await this.withHealing('click', `Click ${desc}`, locator, (loc) => loc.click());
  }

  protected async fill(locator: Locator, value: string, description?: string): Promise<void> {
    const desc = description ?? 'field';
    this.track('fill', `Fill ${desc}`, locator, value);
    logger.debug(`Fill [${desc}]: ${value}`);
    await this.withHealing('fill', `Fill ${desc}`, locator, async (loc) => {
      await loc.clear();
      await loc.fill(value);
    });
  }

  protected async selectOption(locator: Locator, value: string): Promise<void> {
    this.track('select', `Select "${value}"`, locator, value);
    await this.withHealing('select', `Select "${value}"`, locator, (loc) => loc.selectOption(value).then(() => undefined));
  }

  protected async getText(locator: Locator): Promise<string> {
    return (await locator.textContent()) ?? '';
  }

  async expectVisible(locator: Locator, message?: string): Promise<void> {
    this.track('assertion', message ?? 'Expect element visible', locator);
    await expect(locator, message).toBeVisible();
  }

  async expectHidden(locator: Locator, message?: string): Promise<void> {
    this.track('assertion', message ?? 'Expect element hidden', locator);
    await expect(locator, message).toBeHidden();
  }

  async expectText(locator: Locator, text: string): Promise<void> {
    this.track('assertion', `Expect text "${text}"`, locator);
    await expect(locator).toHaveText(text);
  }

  async expectURL(pattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(pattern);
  }

  async takeScreenshot(name: string): Promise<Buffer> {
    return this.page.screenshot({
      path: `test-results/screenshots/${name}.png`,
      fullPage: true,
    });
  }
}
