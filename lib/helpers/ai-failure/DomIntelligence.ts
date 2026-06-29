/// <reference lib="dom" />
/**
 * DomIntelligence — locates the failing element and extracts a compact, denoised
 * JSON snapshot instead of raw HTML.
 *
 * The heavy lifting runs inside the browser via a single page.evaluate call: it
 * walks the element, its parent hierarchy and relevant siblings, strips noise
 * (<script>/<style>/SVG paths/analytics/framework metadata/unrelated hidden
 * nodes) and returns only interaction-relevant facts. This keeps the payload an
 * order of magnitude smaller than a DOM dump — the key to low LLM token usage.
 */

import type { Locator, Page } from 'playwright';
import type { DomIntelligenceResult } from './types';

export class DomIntelligence {
  /**
   * Extract compact DOM intelligence for the failing locator.
   * Falls back gracefully when the locator is missing or resolves to nothing.
   */
  static async extract(page: Page, locator?: Locator): Promise<DomIntelligenceResult> {
    if (!locator) {
      return { resolved: false, matchCount: 0, error: 'No locator associated with the failed action' };
    }

    let matchCount = 0;
    try {
      matchCount = await locator.count();
    } catch {
      return { resolved: false, matchCount: 0, error: 'Locator could not be evaluated' };
    }

    if (matchCount === 0) {
      return { resolved: false, matchCount: 0, error: 'Locator resolved to zero elements' };
    }

    const handle = await locator.first().elementHandle();
    if (!handle) {
      return { resolved: false, matchCount, error: 'Element handle unavailable' };
    }

    try {
      const data = (await page.evaluate(DomIntelligence.snapshotFn, handle)) as unknown as Omit<
        DomIntelligenceResult,
        'resolved' | 'matchCount' | 'error'
      >;
      return { resolved: matchCount === 1, matchCount, ...data };
    } catch (err) {
      return { resolved: false, matchCount, error: `DOM snapshot failed: ${(err as Error).message}` };
    } finally {
      await handle.dispose();
    }
  }

  /**
   * Serialized browser-side function — implements the Intelligent DOM Window.
   * Executes entirely inside the page context via a single page.evaluate call.
   * No Node APIs, no TypeScript types at runtime, no raw HTML in the output.
   *
   * Tiers implemented:
   *   1  Target element with bounding box and computed styles
   *   3  Ancestor chain as compact label strings
   *   4  Blocking overlay detection
   *   5  Accessibility snapshot (role, name, disabled, focused, required)
   *   7  Compressed DOM tree rooted at the nearest meaningful ancestor
   *   9  Semantic page summary (buttons, inputs, forms, dialogs, headings)
   *  11  Element fingerprint with nearby text
   *  12  Local DOM window (parent, siblings, children)
   */
  private static snapshotFn = (el: Element) => {
    const MAX_TEXT   = 120;
    const MAX_ANCS   = 7;
    const htmlEl     = el as HTMLElement;
    const style      = window.getComputedStyle(htmlEl);
    const rect       = htmlEl.getBoundingClientRect();

    // ── Compact element descriptor (noise-stripped attribute map) ────────────
    const compact = (node: Element | null): Record<string, unknown> | undefined => {
      if (!node) return undefined;
      const tag = node.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path' || tag === 'noscript') return { tag };
      const dataAttr: Record<string, string> = {};
      const ariaAttr: Record<string, string> = {};
      for (const a of Array.from(node.attributes)) {
        const n = a.name;
        if (n.startsWith('_ng') || n.startsWith('ng-') || n.startsWith('data-reactid') ||
            n.startsWith('data-v-') || n.startsWith('data-gtm') || n.includes('analytics')) continue;
        if (n.startsWith('data-')) dataAttr[n] = a.value.slice(0, 80);
        else if (n.startsWith('aria-')) ariaAttr[n] = a.value.slice(0, 80);
      }
      const text    = (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
      const classes = node.className && typeof node.className === 'string'
        ? node.className.split(/\s+/).filter(Boolean).slice(0, 12) : undefined;
      const info: Record<string, unknown> = { tag };
      if (text)                          info.text = text;
      if ((node as HTMLElement).id)      info.id   = (node as HTMLElement).id;
      if (classes?.length)               info.classes = classes;
      if (Object.keys(dataAttr).length)  info.dataAttributes = dataAttr;
      if (Object.keys(ariaAttr).length)  info.ariaAttributes = ariaAttr;
      const role = node.getAttribute('role');         if (role) info.role = role;
      const name = node.getAttribute('name');         if (name) info.name = name;
      const type = node.getAttribute('type');         if (type) info.type = type;
      return info;
    };

    // ── Tier 1: State + bounding box ─────────────────────────────────────────
    const disabled = (htmlEl as HTMLButtonElement).disabled === true ||
      htmlEl.getAttribute('disabled') !== null ||
      htmlEl.getAttribute('aria-disabled') === 'true';
    const visible = !!(rect.width || rect.height) &&
      style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    const editable = htmlEl.isContentEditable ||
      (['input', 'textarea', 'select'].includes(htmlEl.tagName.toLowerCase()) && !disabled);
    const checked  = (htmlEl as HTMLInputElement).checked;
    const boundingBox = (rect.width || rect.height)
      ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      : undefined;

    // ── Tier 3: Ancestor chain ────────────────────────────────────────────────
    const ancestorChain: string[] = [];
    let anc: HTMLElement | null = htmlEl.parentElement;
    while (anc && anc.tagName.toLowerCase() !== 'html' && ancestorChain.length < MAX_ANCS) {
      const t   = anc.tagName.toLowerCase();
      let   seg = t;
      if (anc.id) {
        seg += '#' + anc.id;
      } else if (anc.className && typeof anc.className === 'string') {
        const cls = anc.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        if (cls) seg += '.' + cls;
      }
      const label = (anc.getAttribute('aria-label') || anc.getAttribute('title') || '').slice(0, 25);
      if (label) seg += '[' + label + ']';
      ancestorChain.unshift(seg);
      anc = anc.parentElement;
    }

    // ── Tier 4: Blocking overlay ──────────────────────────────────────────────
    let blockingOverlay: { tag: string; classes?: string[]; zIndex: string } | undefined;
    try {
      const cx  = rect.left + rect.width  / 2;
      const cy  = rect.top  + rect.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== htmlEl && !htmlEl.contains(top) && !top.contains(htmlEl)) {
        const ts  = window.getComputedStyle(top as HTMLElement);
        const z   = ts.zIndex;
        const cls = (top.className && typeof top.className === 'string') ? top.className : '';
        const isOverlay = /overlay|modal|spinner|loading|backdrop|mask/i.test(cls) ||
          (z !== 'auto' && parseInt(z, 10) >= 10);
        if (isOverlay) blockingOverlay = {
          tag:     top.tagName.toLowerCase(),
          classes: cls ? cls.split(/\s+/).filter(Boolean).slice(0, 8) : undefined,
          zIndex:  z,
        };
      }
    } catch { /* elementFromPoint can throw on detached nodes */ }

    // ── Tier 5: Accessibility snapshot ───────────────────────────────────────
    const ariaLabel      = htmlEl.getAttribute('aria-label');
    const ariaLabelledby = htmlEl.getAttribute('aria-labelledby');
    const titleAttr      = htmlEl.getAttribute('title');
    let   accessibleName = ariaLabel || '';
    if (!accessibleName && ariaLabelledby) {
      accessibleName = ariaLabelledby.split(/\s+/).map((refId) => {
        const ref = document.getElementById(refId);
        return ref ? (ref.textContent || '').trim() : '';
      }).filter(Boolean).join(' ');
    }
    if (!accessibleName) accessibleName = titleAttr || '';
    const a11y: Record<string, unknown> = {
      role:     htmlEl.getAttribute('role') || undefined,
      name:     accessibleName || undefined,
      label:    ariaLabel      || undefined,
      disabled: disabled,
      focused:  document.activeElement === htmlEl,
    };
    const required = (htmlEl as HTMLInputElement).required || htmlEl.getAttribute('aria-required') === 'true';
    if (required)                                   a11y.required = true;
    if (htmlEl.hasAttribute('aria-expanded'))       a11y.expanded = htmlEl.getAttribute('aria-expanded') === 'true';

    // ── Tier 11: Element fingerprint ─────────────────────────────────────────
    const pathParts: string[] = [];
    let   pathNode: HTMLElement | null = htmlEl;
    while (pathNode && pathNode.tagName.toLowerCase() !== 'body') {
      pathParts.unshift(pathNode.tagName.toLowerCase() + (pathNode.id ? '#' + pathNode.id : ''));
      pathNode = pathNode.parentElement;
    }
    const nearbyText: string[] = [];
    if (htmlEl.parentElement) {
      Array.from(htmlEl.parentElement.children)
        .filter((k) => k !== htmlEl).slice(0, 5)
        .forEach((k) => {
          const t = (k.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
          if (t) nearbyText.push(t);
        });
    }
    const elTag = htmlEl.tagName.toLowerCase();
    const implicitRole =
      elTag === 'button'   ? 'button'   :
      elTag === 'a'        ? 'link'     :
      elTag === 'input'    ? 'textbox'  :
      elTag === 'select'   ? 'combobox' : undefined;
    const fingerprint = {
      tag:        elTag,
      role:       (htmlEl.getAttribute('role') || implicitRole) ?? undefined,
      text:       (htmlEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT) || undefined,
      path:       pathParts.join('>'),
      nearbyText: nearbyText.slice(0, 4),
    };

    // ── Tier 12: Local DOM window ─────────────────────────────────────────────
    const parent   = htmlEl.parentElement ? compact(htmlEl.parentElement) : undefined;
    const siblings: Array<Record<string, unknown>> = [];
    if (htmlEl.parentElement) {
      Array.from(htmlEl.parentElement.children)
        .filter((k) => k !== htmlEl).slice(0, 6)
        .forEach((k) => { const c = compact(k); if (c) siblings.push(c); });
    }
    const children: Array<Record<string, unknown>> = [];
    Array.from(htmlEl.children).slice(0, 5).forEach((k) => { const c = compact(k); if (c) children.push(c); });
    const localWindow = { parent, siblings, children };

    // ── Tier 9: Semantic page summary ─────────────────────────────────────────
    const getText = (el: Element) =>
      (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const semanticSummary = {
      pageTitle: document.title || undefined,
      buttons: Array.from(document.querySelectorAll(
        'button:not([hidden]),[role="button"]:not([hidden]),input[type=submit],input[type=button]'
      )).slice(0, 12).map(getText).filter(Boolean),
      inputs: Array.from(document.querySelectorAll(
        'input:not([type=hidden]),textarea,select'
      )).slice(0, 12).map((i) => {
        const t = i.getAttribute('type') || i.tagName.toLowerCase();
        const n = i.getAttribute('name') || i.getAttribute('placeholder') || i.getAttribute('aria-label') || '';
        return n ? `${t}[${n}]` : t;
      }).filter(Boolean),
      forms:   Array.from(document.querySelectorAll('form')).slice(0, 5)
                 .map((f) => f.id || f.getAttribute('name') || f.getAttribute('aria-label') || 'form'),
      dialogs: Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog],dialog')).slice(0, 3)
                 .map((d) => d.getAttribute('aria-label') || d.getAttribute('aria-labelledby') || 'dialog'),
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 6)
                  .map((h) => (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60))
                  .filter(Boolean),
    };

    // ── Tier 7: Compressed DOM tree ───────────────────────────────────────────
    // Locate the nearest meaningful ancestor to use as the tree root.
    let treeRoot: HTMLElement = htmlEl;
    let tp = htmlEl.parentElement;
    while (tp && tp.tagName.toLowerCase() !== 'body') {
      const t = tp.tagName.toLowerCase();
      if (tp.id || ['form','dialog','section','main','article','table','ul','ol','nav','aside'].includes(t)) {
        treeRoot = tp; break;
      }
      tp = tp.parentElement;
    }
    const treeLines: string[] = [];
    const buildTree = (node: Element, prefix: string, isLast: boolean, depth: number): void => {
      if (depth > 4) return;
      const t = node.tagName.toLowerCase();
      if (t === 'script' || t === 'style' || t === 'svg' || t === 'canvas' || t === 'noscript') return;
      if (window.getComputedStyle(node as HTMLElement).display === 'none' && node !== htmlEl) return;
      const nodeId  = (node as HTMLElement).id ? '#' + (node as HTMLElement).id : '';
      const nodeCls = typeof node.className === 'string'
        ? node.className.split(/\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join('') : '';
      const nodeText = (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22);
      const isTarget = node === htmlEl;
      const conn     = prefix === '' ? '' : (isLast ? '└── ' : '├── ');
      treeLines.push(`${prefix}${conn}${t}${nodeId}${nodeCls}${nodeText ? ` "${nodeText}"` : ''}${isTarget ? ' ← TARGET' : ''}`);
      const kids = Array.from(node.children).filter((k) => {
        const kt = k.tagName.toLowerCase();
        return kt !== 'script' && kt !== 'style' && kt !== 'svg' && kt !== 'canvas' && kt !== 'noscript';
      });
      const shown     = kids.slice(0, 7);
      const childPfx  = prefix === '' ? '' : (isLast ? '    ' : '│   ');
      shown.forEach((k, i) => buildTree(k, childPfx, i === shown.length - 1, depth + 1));
      if (kids.length > 7) treeLines.push(`${childPfx}    … (${kids.length - 7} more)`);
    };
    buildTree(treeRoot, '', true, 0);
    const domTree = treeLines.join('\n');

    return {
      element:         compact(htmlEl),
      state:           { visible, enabled: !disabled, disabled, editable, checked },
      styles:          { display: style.display, visibility: style.visibility, opacity: style.opacity,
                         pointerEvents: style.pointerEvents, zIndex: style.zIndex },
      boundingBox,
      ancestorChain,
      a11y,
      fingerprint,
      localWindow,
      blockingOverlay,
      semanticSummary,
      domTree,
    };
  };
}
