/// <reference lib="dom" />
/**
 * InteractionSnapshotCapture — records a full element fingerprint after a
 * successful Playwright interaction so it can later be compared against the DOM
 * when the same locator fails ("old info" of the old-vs-new comparison).
 *
 * Injection point: called from BasePage action methods (click/fill/select/…)
 * AFTER the action resolves — not from a hook — so each interaction is captured
 * with step-level granularity at the exact moment it succeeded.
 *
 * Safety: never throws and never blocks meaningfully. The fingerprint + optional
 * screenshot are extracted synchronously (they must reflect interaction-time
 * state), then the database write is enqueued fire-and-forget on AiDbClient.
 * When the store is disabled/unavailable the whole call is a cheap no-op.
 *
 * Config:
 *   AI_STORE_SCREENSHOTS — "false" to skip the cropped element screenshot (default true)
 */

import type { Locator, Page } from 'playwright';
import { getEnvBool } from '@utils/env';
import { logger } from '@utils/logger';
import { AiDbClient } from './db/AiDbClient';
import { InteractionSnapshotRepo } from './InteractionSnapshotRepo';
import type { ActionType, InteractionFingerprint } from './types';

export interface CaptureContext {
  scenarioName: string;
  stepText: string;
  actionType: ActionType;
}

export class InteractionSnapshotCapture {
  /**
   * Capture a snapshot for a successful interaction. Fire-and-forget from the
   * caller's perspective for the DB write; the fingerprint itself is extracted
   * inline so it reflects the DOM at interaction time. Never throws.
   */
  static async capture(
    page: Page,
    locator: Locator,
    ctx: CaptureContext
  ): Promise<void> {
    try {
      if (!AiDbClient.isFeatureEnabled()) return;
      // Skip all browser work when there is no usable store.
      if (!(await AiDbClient.ready())) return;

      const fingerprint = await InteractionSnapshotCapture.extractFingerprint(page, locator);
      if (!fingerprint) return;

      let screenshotBase64: string | undefined;
      if (getEnvBool('AI_STORE_SCREENSHOTS', true)) {
        screenshotBase64 = await locator
          .first()
          .screenshot({ timeout: 3000 })
          .then((b) => b.toString('base64'))
          .catch(() => undefined);
      }

      const locatorString = String(locator);
      const snapshot = {
        scenarioName: ctx.scenarioName,
        stepText: ctx.stepText,
        url: page.url(),
        locatorString,
        actionType: ctx.actionType,
        locatorStrategy: InteractionSnapshotCapture.strategyOf(locatorString),
        fingerprint,
        screenshotBase64,
        capturedAt: new Date().toISOString(),
      };

      AiDbClient.enqueueWrite(() => InteractionSnapshotRepo.upsertSnapshot(snapshot));
    } catch (err) {
      logger.debug(`[InteractionSnapshotCapture] capture skipped: ${(err as Error).message}`);
    }
  }

  /**
   * Extract the full fingerprint for the (first) element a locator resolves to.
   * Returns undefined when the locator resolves to nothing or extraction fails.
   * Public so the FailureIntelligenceEngine can fingerprint the *current* best
   * candidate at failure time using the identical shape.
   */
  static async extractFingerprint(page: Page, locator: Locator): Promise<InteractionFingerprint | undefined> {
    try {
      const count = await locator.count();
      if (count === 0) return undefined;
      const handle = await locator.first().elementHandle();
      if (!handle) return undefined;
      try {
        const fp = (await page.evaluate(InteractionSnapshotCapture.extractFn, handle)) as InteractionFingerprint;
        return fp;
      } finally {
        await handle.dispose();
      }
    } catch {
      return undefined;
    }
  }

  /** Derive a coarse locator strategy label from a locator string. */
  private static strategyOf(locatorString: string): string {
    const m = locatorString.match(/getBy[A-Za-z]+/);
    if (m) return m[0];
    if (/(^|\.)locator\(/.test(locatorString) || /^(internal:|css=|xpath=|\/\/|[.#\[a-zA-Z])/.test(locatorString)) {
      return 'locator';
    }
    return 'unknown';
  }

  /**
   * Browser-side fingerprint builder. Runs entirely inside the page via a single
   * page.evaluate call. No Node APIs, no TS types at runtime.
   */
  private static extractFn = (el: Element): unknown => {
    const MAX_TEXT = 120;
    const htmlEl = el as HTMLElement;
    const rect = htmlEl.getBoundingClientRect();
    const clean = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
    const tagOf = (n: Element) => n.tagName.toLowerCase();

    const implicitRole = (n: Element): string | undefined => {
      const t = tagOf(n);
      const type = n.getAttribute('type');
      if (t === 'button') return 'button';
      if (t === 'a' && n.hasAttribute('href')) return 'link';
      if (t === 'select') return 'combobox';
      if (t === 'textarea') return 'textbox';
      if (t === 'input') {
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        return 'textbox';
      }
      if (/^h[1-6]$/.test(t)) return 'heading';
      return undefined;
    };

    const roleOf = (n: Element): string | undefined => n.getAttribute('role') || implicitRole(n) || undefined;

    const accessibleNameOf = (n: Element): string => {
      const aria = n.getAttribute('aria-label');
      if (aria) return clean(aria);
      const labelledby = n.getAttribute('aria-labelledby');
      if (labelledby) {
        const text = labelledby
          .split(/\s+/)
          .map((id) => {
            const ref = document.getElementById(id);
            return ref ? clean(ref.textContent) : '';
          })
          .filter(Boolean)
          .join(' ');
        if (text) return text;
      }
      // <label for> or wrapping <label>
      const id = (n as HTMLElement).id;
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab) return clean(lab.textContent);
      }
      const wrapLabel = n.closest('label');
      if (wrapLabel) return clean(wrapLabel.textContent);
      const title = n.getAttribute('title');
      if (title) return clean(title);
      const ph = n.getAttribute('placeholder');
      if (ph) return clean(ph);
      // For buttons/links the visible text is the accessible name.
      return clean(n.textContent).slice(0, MAX_TEXT);
    };

    // ── Accessibility ────────────────────────────────────────────────────────
    const ariaChecked = htmlEl.getAttribute('aria-checked');
    const ariaExpanded = htmlEl.getAttribute('aria-expanded');
    const ariaSelected = htmlEl.getAttribute('aria-selected');
    const ariaPressed = htmlEl.getAttribute('aria-pressed');
    const descId = htmlEl.getAttribute('aria-describedby');
    const description = descId
      ? descId.split(/\s+/).map((i) => { const r = document.getElementById(i); return r ? clean(r.textContent) : ''; }).filter(Boolean).join(' ')
      : undefined;

    const a11y = {
      role: roleOf(htmlEl),
      accessibleName: accessibleNameOf(htmlEl) || undefined,
      description: description || undefined,
      checked: typeof (htmlEl as HTMLInputElement).checked === 'boolean' && tagOf(htmlEl) === 'input'
        ? (htmlEl as HTMLInputElement).checked
        : ariaChecked === 'true' ? true : ariaChecked === 'false' ? false : undefined,
      disabled: (htmlEl as HTMLButtonElement).disabled === true
        || htmlEl.getAttribute('disabled') !== null
        || htmlEl.getAttribute('aria-disabled') === 'true',
      expanded: ariaExpanded === 'true' ? true : ariaExpanded === 'false' ? false : undefined,
      selected: ariaSelected === 'true' ? true : ariaSelected === 'false' ? false : undefined,
      pressed: ariaPressed === 'true' ? true : ariaPressed === 'false' ? false : undefined,
      required: (htmlEl as HTMLInputElement).required || htmlEl.getAttribute('aria-required') === 'true' || undefined,
      readonly: (htmlEl as HTMLInputElement).readOnly || htmlEl.getAttribute('aria-readonly') === 'true' || undefined,
    };

    // ── DOM ────────────────────────────────────────────────────────────────
    const dataAttr: Record<string, string> = {};
    const ariaAttr: Record<string, string> = {};
    const attrs: Record<string, string> = {};
    for (const a of Array.from(htmlEl.attributes)) {
      const n = a.name;
      if (n.startsWith('_ng') || n.startsWith('ng-') || n.startsWith('data-reactid') ||
          n.startsWith('data-v-') || n.startsWith('data-gtm') || n.includes('analytics')) continue;
      if (n.startsWith('aria-')) ariaAttr[n] = a.value.slice(0, 80);
      else if (n === 'class' || n === 'style') continue;
      else attrs[n] = a.value.slice(0, 80);
      if (n.startsWith('data-')) dataAttr[n] = a.value.slice(0, 80);
    }
    const classes = htmlEl.className && typeof htmlEl.className === 'string'
      ? htmlEl.className.split(/\s+/).filter(Boolean).slice(0, 12) : undefined;

    const dom = {
      tag: tagOf(htmlEl),
      id: htmlEl.id || undefined,
      classes: classes && classes.length ? classes : undefined,
      attributes: Object.keys(attrs).length ? attrs : undefined,
      text: clean(htmlEl.textContent).slice(0, MAX_TEXT) || undefined,
      placeholder: htmlEl.getAttribute('placeholder') || undefined,
      title: htmlEl.getAttribute('title') || undefined,
      ariaAttributes: Object.keys(ariaAttr).length ? ariaAttr : undefined,
      inputType: htmlEl.getAttribute('type') || undefined,
      name: htmlEl.getAttribute('name') || undefined,
      value: (htmlEl as HTMLInputElement).value || htmlEl.getAttribute('value') || undefined,
    };

    // ── Position ─────────────────────────────────────────────────────────────
    let domDepth = 0;
    let depthNode: HTMLElement | null = htmlEl;
    while (depthNode && tagOf(depthNode) !== 'body') { domDepth++; depthNode = depthNode.parentElement; }
    const siblingIndex = htmlEl.parentElement
      ? Array.from(htmlEl.parentElement.children).indexOf(htmlEl)
      : 0;
    const position = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      domDepth,
      siblingIndex,
    };

    // ── Parents (up to 2 meaningful levels) ──────────────────────────────────
    const parents: Array<{ tag: string; role?: string; accessibleName?: string }> = [];
    let p: HTMLElement | null = htmlEl.parentElement;
    while (p && tagOf(p) !== 'body' && tagOf(p) !== 'html' && parents.length < 2) {
      parents.push({
        tag: tagOf(p),
        role: roleOf(p),
        accessibleName: accessibleNameOf(p).slice(0, 60) || undefined,
      });
      p = p.parentElement;
    }

    // ── Neighbourhood ─────────────────────────────────────────────────────────
    const prev = htmlEl.previousElementSibling;
    const next = htmlEl.nextElementSibling;
    const scope = htmlEl.closest('form, section, main, dialog, [role="dialog"], fieldset') ?? document.body;
    const textsOf = (sel: string, max: number): string[] =>
      Array.from(scope.querySelectorAll(sel))
        .map((n) => clean(n.textContent) || clean(n.getAttribute('aria-label')) || clean(n.getAttribute('placeholder')))
        .filter(Boolean)
        .slice(0, max);
    const neighbourhood = {
      previousSibling: prev ? `${tagOf(prev)}${prev.textContent ? ' "' + clean(prev.textContent).slice(0, 40) + '"' : ''}` : undefined,
      nextSibling: next ? `${tagOf(next)}${next.textContent ? ' "' + clean(next.textContent).slice(0, 40) + '"' : ''}` : undefined,
      nearbyLabels: textsOf('label', 6),
      nearbyHeadings: textsOf('h1,h2,h3,h4', 4),
      nearbyButtons: textsOf('button,[role="button"],input[type=submit],input[type=button]', 6),
      nearbyTextboxes: Array.from(scope.querySelectorAll('input:not([type=hidden]),textarea'))
        .map((n) => n.getAttribute('name') || n.getAttribute('placeholder') || n.getAttribute('aria-label') || tagOf(n))
        .filter(Boolean)
        .slice(0, 6),
    };

    // ── Semantic path (role(name) chain of meaningful ancestors) ─────────────
    const segs: string[] = [];
    let s: HTMLElement | null = htmlEl;
    while (s && tagOf(s) !== 'html') {
      const t = tagOf(s);
      const r = roleOf(s);
      const meaningful = !!r || ['main', 'form', 'nav', 'header', 'footer', 'section', 'dialog', 'fieldset', 'aside', 'article'].includes(t);
      if (meaningful) {
        const name = accessibleNameOf(s).slice(0, 30);
        segs.unshift(`${r || t}${name ? '(' + name + ')' : ''}`);
      }
      s = s.parentElement;
    }
    const semanticPath = segs.join(' → ');

    return { a11y, dom, position, parents, neighbourhood, semanticPath };
  };
}
