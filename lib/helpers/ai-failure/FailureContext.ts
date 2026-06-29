/**
 * FailureContext — per-page diagnostic recorder.
 *
 * Each Playwright {@link Page} gets its own context (stored in a WeakMap, so it is
 * cleaned up automatically when the page is garbage-collected). Page objects record
 * the last user action here; the World attaches console/network listeners that feed
 * it. On failure the After hook reads it back to build the intelligence package.
 *
 * Using a WeakMap keyed by Page keeps the design parallel-safe — each Cucumber
 * scenario owns a distinct page, so contexts never collide across workers.
 */

import type { Page, ConsoleMessage, Request, Response } from 'playwright';
import type { ActionRecord, ConsoleEntry, NetworkEntry, ActionType } from './types';

const MAX_CONSOLE = 50;
const MAX_NETWORK = 100;

export class FailureContext {
  private static store = new WeakMap<Page, FailureContext>();

  lastAction?: ActionRecord;
  currentStepText = '';
  readonly consoleLogs: ConsoleEntry[] = [];
  readonly networkRequests: NetworkEntry[] = [];
  readonly networkFailures: NetworkEntry[] = [];

  /** Get (or lazily create) the context bound to a page. */
  static for(page: Page): FailureContext {
    let ctx = this.store.get(page);
    if (!ctx) {
      ctx = new FailureContext();
      this.store.set(page, ctx);
    }
    return ctx;
  }

  /** Drop the context for a page — call between scenarios reusing a page. */
  static reset(page: Page): void {
    this.store.delete(page);
  }

  private static now(): string {
    // Date.now()/new Date() are fine in framework runtime (not a workflow script).
    return new Date().toISOString();
  }

  recordAction(action: Omit<ActionRecord, 'timestamp'>): void {
    this.lastAction = { ...action, timestamp: FailureContext.now() };
  }

  setCurrentStep(text: string): void {
    this.currentStepText = text;
  }

  // ── Browser event sinks (attached once per page in the World) ──────────────

  attachListeners(page: Page): void {
    page.on('console', (msg) => this.onConsole(msg));
    page.on('pageerror', (err) => this.onPageError(err));
    page.on('requestfailed', (req) => this.onRequestFailed(req));
    page.on('response', (res) => this.onResponse(res));
  }

  private onConsole(msg: ConsoleMessage): void {
    const type = msg.type();
    // Keep only signal — errors and warnings drive root-cause rules.
    if (type !== 'error' && type !== 'warning') return;
    this.push(this.consoleLogs, MAX_CONSOLE, {
      type,
      text: msg.text(),
      timestamp: FailureContext.now(),
    });
  }

  private onPageError(err: Error): void {
    this.push(this.consoleLogs, MAX_CONSOLE, {
      type: 'pageerror',
      text: err.message,
      timestamp: FailureContext.now(),
    });
  }

  private onRequestFailed(req: Request): void {
    this.push(this.networkFailures, MAX_NETWORK, {
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText ?? 'request failed',
      timestamp: FailureContext.now(),
    });
  }

  private onResponse(res: Response): void {
    const status = res.status();
    const entry: NetworkEntry = {
      url: res.url(),
      method: res.request().method(),
      status,
      timestamp: FailureContext.now(),
    };
    this.push(this.networkRequests, MAX_NETWORK, entry);
    if (status >= 400) {
      this.push(this.networkFailures, MAX_NETWORK, entry);
    }
  }

  private push<T>(buffer: T[], cap: number, item: T): void {
    buffer.push(item);
    if (buffer.length > cap) buffer.shift();
  }
}

/** Map a free-text description to a coarse action type (best-effort). */
export function inferActionType(method: string): ActionType {
  switch (method) {
    case 'click':
      return 'click';
    case 'fill':
      return 'fill';
    case 'selectOption':
      return 'select';
    case 'navigate':
      return 'navigate';
    default:
      return 'unknown';
  }
}
