/// <reference lib="dom" />
/**
 * SimilarityEngine — when a locator fails to resolve, scans the live DOM for
 * elements that most closely resemble the intended target and ranks them by a
 * weighted similarity score.
 *
 * Weights (per spec Phase 4):
 *   data-testid 40 | role 25 | text 25 | id 20 | aria-label 20 | name attr 35
 *   placeholder 25 | type 15 | tag 10 | class similarity 10
 *
 * All heavy work runs inside a single page.evaluate call. Falls back to [] on
 * any error so it never blocks the main failure pipeline.
 */

import type { Page } from 'playwright';
import type { FailedAction, SimilarityCandidate } from './types';
import { logger } from '@utils/logger';

/** Characteristics parsed from the failing CSS/Playwright selector (Node side). */
interface ParsedTarget {
  tag?: string;
  id?: string;
  classes?: string[];
  dataTestId?: string;
  role?: string;
  /** Accessible name — from getByRole({ name }), getByLabel, internal:role[name=].
   *  Scored against aria-label, placeholder, title, aria-labelledby in the browser. */
  accessibleName?: string;
  /** Visible text content — from getByText / getByTitle / raw CSS :text. */
  text?: string;
  placeholder?: string;
  ariaLabel?: string;
  name?: string;
  type?: string;
  /** The `value` attribute — for input[value="…"], radios, checkboxes, options. */
  value?: string;
}

export class SimilarityEngine {
  /**
   * Return up to `maxResults` DOM elements most similar to the failing locator.
   * Returns an empty array when the selector is unavailable or the page throws.
   */
  static async findCandidates(
    page: Page,
    failedAction: FailedAction,
    maxResults = 5
  ): Promise<SimilarityCandidate[]> {
    const selector = failedAction.selector;
    logger.debug(`[SimilarityEngine] raw selector string: ${JSON.stringify(selector)}`);

    if (!selector) {
      logger.debug('[SimilarityEngine] no selector — skipping');
      return [];
    }

    const target = SimilarityEngine.parseSelector(selector);
    logger.debug(`[SimilarityEngine] parsed target: ${JSON.stringify(target)}`);

    if (Object.keys(target).length === 0) {
      logger.warn(`[SimilarityEngine] parseSelector extracted nothing from: ${selector}`);
      return [];
    }

    // ── 1. Accessibility-tree candidates ─────────────────────────────────────
    // For role/name targets (getByRole, getByLabel) the browser already computed
    // the authoritative accessible name. Read it instead of reconstructing it —
    // this is what fixes "only the name is wrong → suggests the wrong element".
    let a11yCandidates: SimilarityCandidate[] = [];
    if (target.role || target.accessibleName || target.ariaLabel) {
      a11yCandidates = await SimilarityEngine.findA11yCandidates(page, target, maxResults);
      logger.debug(`[SimilarityEngine] ${a11yCandidates.length} a11y-tree candidate(s)`);
    }

    // ── 2. Attribute-scraping candidates (fallback for unnamed/roleless nodes) ─
    let attrCandidates: SimilarityCandidate[] = [];
    try {
      attrCandidates = (await page.evaluate(SimilarityEngine.searchFn, { target, maxResults })) as SimilarityCandidate[];
    } catch (err) {
      logger.warn(`[SimilarityEngine] page.evaluate failed: ${(err as Error).message}`);
    }

    // ── 3. Merge: dedup by locator, rank by score (a11y names win on ties) ────
    const seen = new Set<string>();
    const merged = [...a11yCandidates, ...attrCandidates]
      .filter((c) => {
        if (seen.has(c.suggestedLocator)) return false;
        seen.add(c.suggestedLocator);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    logger.debug(`[SimilarityEngine] found ${merged.length} candidate(s) after merge`);
    return merged;
  }

  // ── Accessibility-tree candidate finder (Node side) ──────────────────────────

  /** Roles that aren't useful targets for getByRole — skip them in the tree. */
  private static readonly SKIP_ROLES = new Set([
    'generic', 'none', 'presentation', 'text', 'paragraph', 'linebreak',
    'inlinetextbox', 'rootwebarea', 'document', 'group',
  ]);

  /**
   * Build candidates from the browser-computed accessibility tree (via Playwright's
   * ariaSnapshot, a YAML rendering of role + accessible name). Each node already
   * carries its resolved name, so a role/name target matches the right element
   * directly and yields a guaranteed-resolvable page.getByRole(role, { name }).
   *
   * Example ariaSnapshot lines:
   *   - textbox "First Name"
   *   - button "Submit"
   *   - heading "Sign up" [level=1]
   */
  private static async findA11yCandidates(
    page: Page,
    target: ParsedTarget,
    maxResults: number
  ): Promise<SimilarityCandidate[]> {
    let yaml = '';
    try {
      yaml = await page.locator('body').ariaSnapshot();
    } catch (err) {
      logger.warn(`[SimilarityEngine] ariaSnapshot failed: ${(err as Error).message}`);
      return [];
    }
    if (!yaml) return [];

    // Parse "- <role> "<name>"" lines from the YAML tree.
    const nodes: { role: string; name: string }[] = [];
    const lineRe = /^\s*-\s+([a-zA-Z][a-zA-Z0-9-]*)(?:\s+"((?:[^"\\]|\\.)*)")?/;
    for (const line of yaml.split(/\r?\n/)) {
      const m = line.match(lineRe);
      if (!m) continue;
      nodes.push({ role: m[1], name: m[2] ? m[2].replace(/\\"/g, '"') : '' });
    }

    const wantRole = (target.role || '').toLowerCase();
    const wantName = (target.accessibleName || target.ariaLabel || '').trim();
    const esc = (v: string) => v.slice(0, 60).replace(/'/g, "\\'");

    const scored = nodes
      .map((node) => {
        const role = node.role.toLowerCase();
        if (SimilarityEngine.SKIP_ROLES.has(role)) return null;

        const roleMatches = wantRole ? role === wantRole : false;
        const nameFs = wantName && node.name ? SimilarityEngine.fuzzy(node.name, wantName) : 0;
        const reasons: string[] = [];
        let score = 0;

        if (wantName) {
          if (nameFs <= 0) return null; // name target with no name match — not this node
          // Authoritative name match; a role match adds confidence, a mismatch trims it.
          const factor = wantRole ? (roleMatches ? 1 : 0.7) : 1;
          score = Math.round(nameFs * factor * 99);
          reasons.push(`a11y name "${node.name}" (${Math.round(nameFs * 100)}% match)`);
          if (wantRole) reasons.push(roleMatches ? `role="${role}"` : `role "${role}" ≠ "${wantRole}"`);
        } else if (wantRole) {
          if (!roleMatches) return null; // role-only target, role must match
          score = 40;
          reasons.push(`a11y role="${role}" (no name specified)`);
        } else {
          return null;
        }

        const suggestedLocator = node.name
          ? `page.getByRole('${role}', { name: '${esc(node.name)}' })`
          : `page.getByRole('${role}')`;

        const tag =
          role === 'button' ? 'button' :
          role === 'link' ? 'a' :
          role === 'textbox' || role === 'searchbox' ? 'input' :
          role === 'combobox' || role === 'listbox' ? 'select' : '';

        return {
          score: Math.min(99, score),
          tag,
          text: node.name || undefined,
          role,
          suggestedLocator,
          matchReasons: reasons,
        } as SimilarityCandidate;
      })
      .filter((c): c is SimilarityCandidate => c !== null);

    scored.sort((a, b) => b.score - a.score);

    // Dedup by locator (same role+name collapses to one).
    const seen = new Set<string>();
    return scored.filter((c) => {
      if (seen.has(c.suggestedLocator)) return false;
      seen.add(c.suggestedLocator);
      return true;
    }).slice(0, maxResults);
  }

  /** Node-side fuzzy string similarity 0–1 (mirrors the browser-side fuzzyScore). */
  private static fuzzy(a: string, b: string): number {
    if (!a || !b) return 0;
    const al = a.toLowerCase().trim();
    const bl = b.toLowerCase().trim();
    if (al === bl) return 1.0;
    if (al.includes(bl) || bl.includes(al)) return 0.85;
    const maxLen = Math.max(al.length, bl.length);
    if (Math.abs(al.length - bl.length) > maxLen * 0.5) return 0;
    const prev: number[] = [];
    const curr: number[] = [];
    for (let i = 0; i <= bl.length; i++) prev[i] = i;
    for (let i = 1; i <= al.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= bl.length; j++) {
        curr[j] = al[i - 1] === bl[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      }
      for (let k = 0; k <= bl.length; k++) prev[k] = curr[k];
    }
    return Math.max(0, 1 - prev[bl.length] / maxLen);
  }

  // ── Node-side selector parser ──────────────────────────────────────────────

  /**
   * Extract searchable characteristics from a Playwright locator string.
   *
   * Handles all formats that String(locator) can produce:
   *   getByRole('textbox', { name: 'First name' })
   *   getByPlaceholder('Choose contact type')
   *   getByLabel('Charge_Test_REST')
   *   getByText('Primary')
   *   getByTitle('Continue')
   *   getByTestId('submit-btn')
   *   internal:role=textbox[name="First name"i]
   *   internal:attr=[placeholder="text"i]
   *   internal:text="Primary"
   *   locator('a#landingPageNewAccount')
   *   input[value="Charge_Test_REST"]          (raw CSS)
   */
  private static parseSelector(selector: string): ParsedTarget {
    const target: ParsedTarget = {};
    const s = selector.trim();

    // ── getByRole('role', { name: 'text' }) ────────────────────────────────
    // The 'name' option is the ACCESSIBLE name (aria-label / placeholder / title),
    // not visible text content. Store separately so we check the right DOM sources.
    const roleM = s.match(/getByRole\(['"`]([^'"`]+)['"`](?:\s*,\s*\{[^}]*\bname\s*:\s*['"`]([^'"`]+)['"`][^}]*\})?\)/);
    if (roleM) {
      target.role = roleM[1];
      if (roleM[2]) target.accessibleName = roleM[2];
      return target;
    }

    // ── getByPlaceholder('text') ───────────────────────────────────────────
    const phM = s.match(/getByPlaceholder\(['"`]([^'"`]+)['"`]\)/);
    if (phM) { target.placeholder = phM[1]; return target; }

    // ── getByLabel('text') ─────────────────────────────────────────────────
    const labelM = s.match(/getByLabel\(['"`]([^'"`]+)['"`]\)/);
    if (labelM) { target.ariaLabel = labelM[1]; return target; }

    // ── getByText('text') ──────────────────────────────────────────────────
    const textByM = s.match(/getByText\(['"`]([^'"`]+)['"`]/);
    if (textByM) { target.text = textByM[1]; return target; }

    // ── getByTitle('text') ─────────────────────────────────────────────────
    const titleM = s.match(/getByTitle\(['"`]([^'"`]+)['"`]\)/);
    if (titleM) { target.text = titleM[1]; return target; }

    // ── getByTestId('id') ──────────────────────────────────────────────────
    const tidM = s.match(/getByTestId\(['"`]([^'"`]+)['"`]\)/);
    if (tidM) { target.dataTestId = tidM[1]; return target; }

    // ── Playwright internal selector: internal:role=textbox[name="text"i] ──
    const iRoleM = s.match(/internal:role=([\w-]+)(?:\[name=["']?([^"'\]i]+)i?["']?[^\]]*\])?/);
    if (iRoleM) {
      target.role = iRoleM[1];
      if (iRoleM[2]) target.accessibleName = iRoleM[2].trim();
      return target;
    }

    // ── internal:attr=[attr="value"i] ─────────────────────────────────────
    const iAttrM = s.match(/internal:attr=\[([\w-]+)=["']?([^"'\]i]+)i?["']?[^\]]*\]/);
    if (iAttrM) {
      const [, attr, val] = iAttrM;
      const v = val.trim();
      if (attr === 'placeholder') target.placeholder = v;
      else if (attr === 'aria-label') target.ariaLabel = v;
      else if (attr === 'data-testid') target.dataTestId = v;
      else if (attr === 'name') target.name = v;
      else if (attr === 'title') target.text = v;
      else if (attr === 'value') target.value = v;
      return target;
    }

    // ── internal:text="text" ───────────────────────────────────────────────
    const iTextM = s.match(/internal:text=["']([^"']+)["']/);
    if (iTextM) { target.text = iTextM[1]; return target; }

    // ── internal:label="text" ──────────────────────────────────────────────
    const iLabelM = s.match(/internal:label=["']([^"']+)["']/);
    if (iLabelM) { target.ariaLabel = iLabelM[1]; return target; }

    // ── locator('css') or raw CSS ──────────────────────────────────────────
    let css = s
      .replace(/^(?:page\.)?locator\s*\(\s*/, '')
      .replace(/\s*\)\s*(?:\.first\(\)|\.last\(\)|\.nth\(\d+\))?\s*$/, '')
      .replace(/^(['"`])(.*)\1$/, '$2')
      .replace(/^css=/, '');

    // Skip XPath — not parseable into characteristics
    if (css.startsWith('xpath=') || css.startsWith('//') || css.startsWith('(//')) return target;

    const tagM = css.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagM) target.tag = tagM[1].toLowerCase();

    const idM = css.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/);
    if (idM) target.id = idM[1];

    const classParts = [...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]);
    if (classParts.length) target.classes = classParts;

    const attrRe = /\[([a-zA-Z][a-zA-Z0-9-]*)(?:=|~=|\*=|\$=|\^=)['"`]?([^'"`\]]+)['"`]?\]/g;
    for (const m of [...css.matchAll(attrRe)]) {
      const [, attr, val] = m;
      const v = val.trim();
      if (attr === 'data-testid') target.dataTestId = v;
      else if (attr === 'role') target.role = v;
      else if (attr === 'aria-label') target.ariaLabel = v;
      else if (attr === 'placeholder') target.placeholder = v;
      else if (attr === 'name') target.name = v;
      else if (attr === 'type') target.type = v;
      else if (attr === 'value') target.value = v;
    }

    const hintTextM = css.match(/(?::text\(|:has-text\()['"`]([^'"`]+)['"`]\)/i);
    if (hintTextM) target.text = hintTextM[1];

    return target;
  }

  // ── Browser-side search function ───────────────────────────────────────────

  /**
   * Serialised as-is into page.evaluate — NO closures over outer variables,
   * NO Node APIs, NO TypeScript types at runtime.
   */
  private static searchFn = (args: { target: ParsedTarget; maxResults: number }) => {
    const { target, maxResults } = args;

    // ── Fuzzy string similarity (0–1) ────────────────────────────────────────
    // Returns 1.0 for exact, 0.85 for substring, then Levenshtein-based for
    // near-typos.  A 1-char error on a 10-char string → ~90%.
    const fuzzyScore = (a: string, b: string): number => {
      if (!a || !b) return 0;
      const al = a.toLowerCase().trim();
      const bl = b.toLowerCase().trim();
      if (al === bl) return 1.0;
      if (al.includes(bl) || bl.includes(al)) return 0.85;
      const maxLen = Math.max(al.length, bl.length);
      // Skip expensive Levenshtein when length difference alone rules out a match
      if (Math.abs(al.length - bl.length) > maxLen * 0.5) return 0;
      // Levenshtein distance using two rolling rows
      const prev: number[] = [];
      const curr: number[] = [];
      for (let i = 0; i <= bl.length; i++) prev[i] = i;
      for (let i = 1; i <= al.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= bl.length; j++) {
          curr[j] = al[i - 1] === bl[j - 1]
            ? prev[j - 1]
            : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
        }
        for (let k = 0; k <= bl.length; k++) prev[k] = curr[k];
      }
      return Math.max(0, 1 - prev[bl.length] / maxLen);
    };

    // ── Resolve to the most actionable element ───────────────────────────────
    // The matched element may be a non-interactive wrapper (oj-input-text, span,
    // div, label) or a child of the real target. This climbs to an interactive
    // ancestor or descends to a single interactive descendant so the suggested
    // locator points at something a test can actually click/fill — even when the
    // failing selector named a parent tag instead of the child, or vice versa.
    const isInteractive = (n: Element): boolean => {
      const t = n.tagName.toLowerCase();
      return (
        t === 'a' || t === 'button' || t === 'input' || t === 'select' || t === 'textarea' ||
        n.hasAttribute('role') ||
        (n as HTMLElement).isContentEditable === true
      );
    };
    const resolveActionable = (node: Element): Element => {
      if (isInteractive(node)) return node;
      // Descend: a wrapper with exactly one interactive descendant → use it.
      const descendants = node.querySelectorAll('a, button, input, select, textarea, [role]');
      if (descendants.length >= 1) return descendants[0];
      // Climb: nearest interactive ancestor within a few hops.
      let p: Element | null = node.parentElement;
      let hops = 0;
      while (p && hops < 4) {
        if (isInteractive(p)) return p;
        p = p.parentElement;
        hops++;
      }
      return node;
    };

    // ── Accessible-name sources ──────────────────────────────────────────────
    // How Playwright actually resolves getByRole({ name }) and getByLabel: the
    // name almost always comes from an associated <label> (for= or wrapping),
    // NOT from aria-label/placeholder. Reading only attributes is why a locator
    // whose ONLY error is the name matches every same-role element equally and
    // then picks a wrong one. This gathers every real name source, in priority.
    const accNameSources = (node: Element): string[] => {
      const out: string[] = [];
      const push = (s: string | null) => {
        const t = (s || '').trim().replace(/\s+/g, ' ');
        if (t) out.push(t);
      };
      push(node.getAttribute('aria-label'));
      const lby = node.getAttribute('aria-labelledby');
      if (lby) lby.split(/\s+/).forEach((id) => { const r = document.getElementById(id); if (r) push(r.textContent); });
      const nid = node.getAttribute('id');
      if (nid) {
        try {
          const sel = 'label[for="' + ((window as unknown as { CSS?: { escape(s: string): string } }).CSS?.escape(nid) ?? nid) + '"]';
          document.querySelectorAll(sel).forEach((l) => push(l.textContent));
        } catch { /* id not valid in a selector — ignore */ }
      }
      let p: Element | null = node.parentElement;
      let hops = 0;
      while (p && hops < 4) {
        if (p.tagName === 'LABEL') { push(p.textContent); break; }
        p = p.parentElement; hops++;
      }
      push(node.getAttribute('placeholder'));
      push(node.getAttribute('title'));
      const tg = node.tagName.toLowerCase();
      const r = node.getAttribute('role');
      if (tg === 'button' || tg === 'a' || tg === 'option' || r === 'button' || r === 'link') push(node.textContent);
      return out.filter((v, i) => out.indexOf(v) === i);
    };

    // ── Achievable max — only sum weights for characteristics present in target.
    // Without this, a {role, accessibleName} target always looks like ~26% because
    // we'd divide by 190 even though only 60 points were ever possible.
    const achievableMax =
      (target.dataTestId      ? 40 : 0) +
      (target.role            ? 25 : 0) +
      (target.accessibleName  ? 35 : 0) +   // aria-label / placeholder / title / labelledby
      (target.text            ? 25 : 0) +
      (target.id              ? 20 : 0) +
      (target.tag             ? 10 : 0) +
      (target.ariaLabel       ? 20 : 0) +
      (target.placeholder     ? 25 : 0) +
      (target.name            ? 35 : 0) +   // raised from 15 — primary form field key
      (target.type            ? 15 : 0) +
      (target.value           ? 30 : 0) +   // value="…" is a strong, specific signal
      ((target.classes && target.classes.length) ? 10 : 0);

    if (achievableMax === 0) return [];

    const elements = Array.from(
      document.querySelectorAll(
        'a, button, input, select, textarea, label, [role], [data-testid], ' +
        '[aria-label], [id], [name], [placeholder], [contenteditable="true"]'
      )
    ).slice(0, 400);

    const scored = elements
      .map((el) => {
        const htmlEl = el as HTMLElement;
        let score = 0;
        const reasons: string[] = [];
        const tagName = el.tagName.toLowerCase();

        // ── data-testid (40) — fuzzy ─────────────────────────────────────────
        const testId = el.getAttribute('data-testid');
        if (target.dataTestId && testId) {
          const fs = fuzzyScore(testId, target.dataTestId);
          if (fs > 0) {
            score += fs * 40;
            reasons.push(fs === 1
              ? `data-testid="${testId}" exact`
              : `data-testid "${testId}" (${Math.round(fs * 100)}% match)`);
          }
        }

        // ── role (25) — exact only; roles are a fixed vocabulary ──────────────
        const implicitRole =
          tagName === 'button' ? 'button' :
          tagName === 'a' ? 'link' :
          tagName === 'input' ? 'textbox' :
          tagName === 'select' ? 'combobox' : '';
        const role = el.getAttribute('role') || implicitRole;
        if (target.role && role && role.toLowerCase() === target.role.toLowerCase()) {
          score += 25;
          reasons.push(`role="${role}"`);
        }

        // ── accessible name (35) — fuzzy against all ARIA name sources ────────
        // getByRole({ name }) / getByLabel / internal:role[name=] all target the
        // accessible name, NOT textContent. Form inputs have empty textContent but
        // their accessible name comes from aria-label, placeholder, title, or a
        // label referenced by aria-labelledby.
        const ariaLabel = el.getAttribute('aria-label');
        const placeholder = el.getAttribute('placeholder');
        if (target.accessibleName) {
          const nameSources = accNameSources(el);
          let bestFs = 0;
          let bestSrc = '';
          for (const src of nameSources) {
            const fs = fuzzyScore(src, target.accessibleName);
            if (fs > bestFs) { bestFs = fs; bestSrc = src; }
          }
          if (bestFs > 0) {
            score += bestFs * 35;
            reasons.push(bestFs === 1
              ? `accessible name "${bestSrc}" exact`
              : `accessible name "${bestSrc}" (${Math.round(bestFs * 100)}% match)`);
          }
        }

        // ── visible text (25) — fuzzy ─────────────────────────────────────────
        const text = (htmlEl.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
        if (target.text && text) {
          const fs = fuzzyScore(text, target.text);
          if (fs > 0) {
            score += fs * 25;
            reasons.push(fs === 1
              ? 'text exact match'
              : `text "${text.slice(0, 25)}" (${Math.round(fs * 100)}% match)`);
          }
        }

        // ── id (20) — fuzzy ───────────────────────────────────────────────────
        const id = htmlEl.id;
        if (target.id && id) {
          const fs = fuzzyScore(id, target.id);
          if (fs > 0) {
            score += fs * 20;
            reasons.push(fs === 1
              ? `id="${id}" exact`
              : `id "${id}" (${Math.round(fs * 100)}% match)`);
          }
        }

        // ── tag (10) — exact only; lower weight so semantic matches (placeholder,
        // role, id) win even when the tag in the selector is wrong ──────────────
        if (target.tag && tagName === target.tag) {
          score += 10;
          reasons.push(`tag=<${tagName}>`);
        }

        // ── label (20) — fuzzy; getByLabel resolves to the LABEL text, not the
        // aria-label attribute, so match against all real name sources ──────────
        if (target.ariaLabel) {
          let bestFs = 0;
          let bestSrc = '';
          for (const src of accNameSources(el)) {
            const fs = fuzzyScore(src, target.ariaLabel);
            if (fs > bestFs) { bestFs = fs; bestSrc = src; }
          }
          if (bestFs > 0) {
            score += bestFs * 20;
            reasons.push(bestFs === 1
              ? `label "${bestSrc}" exact`
              : `label "${bestSrc}" (${Math.round(bestFs * 100)}% match)`);
          }
        }

        // ── placeholder (25) — fuzzy; raised weight so an exact placeholder match
        // outscores a tag-only match (tag=10), preventing wrong-tag candidates
        // from beating the correct element when only the tag differs ─────────────
        if (target.placeholder && placeholder) {
          const fs = fuzzyScore(placeholder, target.placeholder);
          if (fs > 0) {
            score += fs * 25;
            reasons.push(fs === 1
              ? `placeholder="${placeholder}"`
              : `placeholder "${placeholder}" (${Math.round(fs * 100)}% match)`);
          }
        }

        // ── type (15) — exact only; e.g. input[type=submit] vs input[type=text]
        const typeAttr = el.getAttribute('type');
        if (target.type && typeAttr && typeAttr.toLowerCase() === target.type.toLowerCase()) {
          score += 15;
          reasons.push(`type="${typeAttr}"`);
        }

        // ── value (30) — fuzzy against the value ATTRIBUTE (not visible text).
        // For input[value="…"], radios, checkboxes and options the value is the
        // identifying signal; matching it against textContent finds wrong elements.
        const valueAttr = el.getAttribute('value');
        if (target.value && valueAttr) {
          const fs = fuzzyScore(valueAttr, target.value);
          if (fs > 0) {
            score += fs * 30;
            reasons.push(fs === 1
              ? `value="${valueAttr}" exact`
              : `value "${valueAttr}" (${Math.round(fs * 100)}% match)`);
          }
        }

        // ── name attribute (35) — fuzzy; raised weight for form identifiers ───
        const nameAttr = el.getAttribute('name');
        if (target.name && nameAttr) {
          const fs = fuzzyScore(nameAttr, target.name);
          if (fs > 0) {
            score += fs * 35;
            reasons.push(fs === 1
              ? `name="${nameAttr}" exact`
              : `name "${nameAttr}" (${Math.round(fs * 100)}% match)`);
          }
        }

        // ── class similarity (10) ─────────────────────────────────────────────
        const classes =
          htmlEl.className && typeof htmlEl.className === 'string'
            ? htmlEl.className.split(/\s+/).filter(Boolean)
            : [];
        if (target.classes && target.classes.length && classes.length) {
          const inter = target.classes.filter((c) => classes.includes(c));
          if (inter.length) {
            const classScore = Math.min(10, Math.round(10 * inter.length / Math.max(target.classes.length, 1)));
            score += classScore;
            reasons.push(`${inter.length} class(es) match: ${inter.slice(0, 3).join(', ')}`);
          }
        }

        if (score === 0 || reasons.length === 0) return null;

        // ── Normalise against achievable max, not a fixed ceiling ─────────────
        const pct = Math.min(99, Math.round((score / achievableMax) * 100));

        // ── Suggest the most resilient Playwright locator ─────────────────────
        // Build from the *actionable* element, not necessarily the matched one:
        // if the match is a wrapper/child, resolveActionable climbs/descends to
        // the real clickable/fillable target. This makes suggestions correct even
        // when the failing selector named a parent tag instead of the child.
        const act        = resolveActionable(htmlEl);
        const actTag     = act.tagName.toLowerCase();
        const actId      = (act as HTMLElement).id;
        const actTestId  = act.getAttribute('data-testid');
        const actAria    = act.getAttribute('aria-label');
        const actPlace   = act.getAttribute('placeholder');
        const actName    = act.getAttribute('name');
        const actValue   = act.getAttribute('value');
        const actText    = (act.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const actImplicitRole =
          actTag === 'button' ? 'button' :
          actTag === 'a'      ? 'link'   :
          actTag === 'input'  ? 'textbox' :
          actTag === 'select' ? 'combobox' : '';
        const actRole    = act.getAttribute('role') || actImplicitRole;
        const actClasses = act.className && typeof act.className === 'string'
          ? act.className.split(/\s+/).filter(Boolean) : [];
        const esc = (v: string) => v.slice(0, 40).replace(/'/g, "\\'");
        const isTextual = actTag === 'a' || actTag === 'button' ||
          actRole === 'link' || actRole === 'button';

        // An id is only worth suggesting if it looks authored, not generated.
        // Trailing digits (optionalBundles0), or ":" / "|" framework ids are
        // positional/dynamic — preferring them over a semantic value/name is how
        // we ended up suggesting a brittle #foo0 instead of fixing a value typo.
        const idUsable = !!actId && !actId.includes('|') && !actId.includes(':');
        const idStable = idUsable && !/\d$/.test(actId) && !/^(ember|ui-id|radix|mui|:r)/i.test(actId);
        const esc2 = (v: string) => v.replace(/"/g, '\\"');

        // Priority (Playwright-recommended, resilient first):
        //   testid > role+aria > role+text > role+placeholder > aria > placeholder
        //   > text > value-intent > stable id > name attr > value > unstable id > css
        let suggestedLocator: string;
        if (actTestId) {
          suggestedLocator = `page.getByTestId('${actTestId}')`;
        } else if (actRole && actAria) {
          suggestedLocator = `page.getByRole('${actRole}', { name: '${esc(actAria)}' })`;
        } else if (actRole && isTextual && actText.length > 1) {
          suggestedLocator = `page.getByRole('${actRole}', { name: '${esc(actText)}' })`;
        } else if (actRole && actPlace) {
          suggestedLocator = `page.getByRole('${actRole}', { name: '${esc(actPlace)}' })`;
        } else if (actAria) {
          suggestedLocator = `page.getByLabel('${esc(actAria)}')`;
        } else if (actPlace) {
          suggestedLocator = `page.getByPlaceholder('${esc(actPlace)}')`;
        } else if (isTextual && actText.length > 1) {
          suggestedLocator = `page.getByText('${esc(actText)}')`;
        } else if (target.value && actValue) {
          // The test already used a value selector — honour that intent (fixes the
          // typo) instead of swapping to a positional id.
          suggestedLocator = `page.locator('${actTag}[value="${esc2(actValue)}"]')`;
        } else if (idStable) {
          suggestedLocator = `page.locator('#${actId}')`;
        } else if (actName && (actTag === 'input' || actTag === 'select' || actTag === 'textarea')) {
          suggestedLocator = `page.locator('${actTag}[name="${actName}"]')`;
        } else if (actValue) {
          suggestedLocator = `page.locator('${actTag}[value="${esc2(actValue)}"]')`;
        } else if (idUsable) {
          // Last-resort: a generated id beats a bare tag, but flag it as fragile.
          suggestedLocator = `page.locator('#${actId}')`;
        } else {
          const clsStr = actClasses.slice(0, 2).map((c) => '.' + c).join('');
          suggestedLocator = `page.locator('${actTag}${idUsable ? '#' + actId : ''}${clsStr}')`;
        }

        // Note when the suggestion was redirected to a different element so the
        // diff can explain the parent/child shift.
        if (act !== htmlEl) {
          reasons.push(`resolved to actionable <${actTag}> (matched element was <${tagName}>)`);
        }

        return {
          score: pct,
          tag: tagName,
          id: id || undefined,
          classes: classes.length ? classes.slice(0, 8) : undefined,
          text: text.slice(0, 80) || undefined,
          role: role || undefined,
          placeholder: placeholder || undefined,
          dataTestId: testId || undefined,
          ariaLabel: ariaLabel || undefined,
          suggestedLocator,
          matchReasons: reasons,
        };
      })
      .filter((c) => c !== null);

    // Sort descending by score.
    (scored as Array<{ score: number }>).sort((a, b) => b.score - a.score);

    // Deduplicate by suggested locator string.
    const seen = new Set<string>();
    return (scored as Array<SimilarityCandidate & { suggestedLocator: string }>)
      .filter((c) => {
        if (seen.has(c.suggestedLocator)) return false;
        seen.add(c.suggestedLocator);
        return true;
      })
      .slice(0, maxResults);
  };
}
