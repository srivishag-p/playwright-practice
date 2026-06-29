/**
 * EvidenceCollector — gathers supporting evidence around a failure: screenshots,
 * console/network logs (from {@link FailureContext}), the stack trace, the parsed
 * Playwright call log, and browser/environment metadata.
 */

import type { Locator, Page } from 'playwright';
import { FailureContext } from './FailureContext';
import { getEnv, getEnvBool } from '@utils/env';
import type { SupportingEvidence } from './types';

export class EvidenceCollector {
  static async collect(
    page: Page,
    errorMessage: string,
    failingLocator?: Locator
  ): Promise<SupportingEvidence> {
    const ctx = FailureContext.for(page);

    const screenshotBase64 = await EvidenceCollector.safeScreenshot(page);
    const elementScreenshotBase64 = await EvidenceCollector.safeElementScreenshot(failingLocator);
    const wholeDomHtml = await EvidenceCollector.safePageContent(page);

    return {
      screenshotBase64,
      elementScreenshotBase64,
      wholeDomHtml,
      consoleLogs: [...ctx.consoleLogs],
      networkRequests: [...ctx.networkRequests],
      networkFailures: [...ctx.networkFailures],
      stackTrace: errorMessage,
      playwrightCallLog: EvidenceCollector.parseCallLog(errorMessage),
      browser: {
        name: getEnv('BROWSER', 'chromium'),
        headless: getEnvBool('HEADLESS', true),
        viewport: page.viewportSize(),
        url: EvidenceCollector.safeUrl(page),
      },
      environment: {
        testEnv: process.env.TEST_ENV ?? 'dev',
        baseUrl: process.env.BASE_URL,
        ci: !!process.env.CI,
        platform: process.platform,
        nodeVersion: process.version,
      },
    };
  }

  private static async safeScreenshot(page: Page): Promise<string | undefined> {
    try {
      const buf = await page.screenshot({ fullPage: true });
      return buf.toString('base64');
    } catch {
      return undefined;
    }
  }

  private static async safePageContent(page: Page): Promise<string | undefined> {
    try {
      return await page.content();
    } catch {
      return undefined;
    }
  }

  private static async safeElementScreenshot(locator?: Locator): Promise<string | undefined> {
    if (!locator) return undefined;
    try {
      if ((await locator.count()) === 0) return undefined;
      const buf = await locator.first().screenshot({ timeout: 3000 });
      return buf.toString('base64');
    } catch {
      return undefined;
    }
  }

  private static safeUrl(page: Page): string | undefined {
    try {
      return page.url();
    } catch {
      return undefined;
    }
  }

  /**
   * Playwright embeds a "Call log:" block in timeout/interaction errors. Extract
   * those lines (each prefixed with "  - ") for the intelligence package.
   */
  static parseCallLog(errorMessage?: string): string[] | undefined {
    if (!errorMessage) return undefined;
    const idx = errorMessage.indexOf('Call log:');
    if (idx === -1) return undefined;
    const block = errorMessage.slice(idx + 'Call log:'.length);
    const lines = block
      .split('\n')
      .map((l) => l.replace(/^\s*-\s?/, '').trim())
      .filter((l) => l.length > 0);
    return lines.length ? lines.slice(0, 30) : undefined;
  }
}
