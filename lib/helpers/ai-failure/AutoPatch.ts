/**
 * AutoPatch — locates the failing locator in the page-object source and produces
 * a ready-to-apply diff that swaps it for the verified fix.
 *
 * Deliberately read-only: it NEVER writes to disk. It scans the page sources for
 * the failing selector literal, rewrites the `this.page.locator(...)` /
 * `this.page.getByX(...)` call on that line to the verified locator, and returns
 * a unified-diff snippet for a human to review and apply.
 *
 * Config (environments/<env>.env):
 *   AI_AUTOPATCH       — "false" to disable (default enabled)
 *   AI_AUTOPATCH_ROOTS — comma-separated source roots to scan (default "lib/pages")
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { getEnv, getEnvBool } from '@utils/env';
import { logger } from '@utils/logger';
import type { PatchSuggestion } from './types';

export class AutoPatch {
  /** Matches the locator-builder call in a page-object field/initializer. */
  private static readonly CALL_RE =
    /this\s*\.\s*page\s*\.\s*(?:locator|getBy[A-Za-z]+)\s*\([\s\S]*?\)(?:\s*\.\s*(?:first|last|nth)\s*\([^)]*\))?/;

  static isEnabled(): boolean {
    return getEnvBool('AI_AUTOPATCH', true);
  }

  /**
   * Produce a patch that replaces `failingSelector` with `verifiedLocator` in the
   * source. Returns undefined when disabled, the fix equals the original, the
   * selector can't be located, or the line can't be safely rewritten.
   */
  static async suggest(
    failingSelector: string | undefined,
    verifiedLocator: string | undefined
  ): Promise<PatchSuggestion | undefined> {
    if (!AutoPatch.isEnabled() || !failingSelector || !verifiedLocator) return undefined;

    const needles = AutoPatch.extractNeedles(failingSelector);
    if (needles.length === 0) return undefined;

    try {
      const roots = getEnv('AI_AUTOPATCH_ROOTS', 'lib/pages')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);

      const files: string[] = [];
      for (const root of roots) {
        await AutoPatch.collectTsFiles(path.resolve(process.cwd(), root), files);
      }

      for (const file of files) {
        const content = await fs.readFile(file, 'utf8');
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const oldLine = lines[i];
          if (!AutoPatch.lineContainsNeedle(oldLine, needles)) continue;
          if (!AutoPatch.CALL_RE.test(oldLine)) continue;

          const newCall = 'this.' + verifiedLocator; // verifiedLocator starts with "page."
          const newLine = oldLine.replace(AutoPatch.CALL_RE, newCall);
          if (newLine === oldLine) continue; // already the verified form — nothing to patch

          const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
          return {
            file: rel,
            line: i + 1,
            oldLine,
            newLine,
            diff: AutoPatch.unifiedDiff(rel, i + 1, oldLine, newLine),
          };
        }
      }
    } catch (err) {
      logger.warn(`[AutoPatch] Could not build patch suggestion: ${(err as Error).message}`);
    }
    return undefined;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Searchable literals from the failing selector string (CSS body, getBy arg). */
  private static extractNeedles(selector: string): string[] {
    const needles: string[] = [];
    const s = selector.trim();

    const locM = s.match(/locator\((['"`])([\s\S]+?)\1\)/);
    if (locM) needles.push(locM[2]);

    const getM = s.match(/getBy[A-Za-z]+\((['"`])([\s\S]+?)\1/);
    if (getM) needles.push(getM[2]);

    // Raw CSS selector (no wrapper) — e.g. 'textarea[placeholder="email"]'
    if (!locM && !getM && /^[a-zA-Z.#\[]/.test(s) && !s.startsWith('internal:')) {
      needles.push(s);
    }

    return [...new Set(needles)].filter((n) => n.length >= 3);
  }

  /** Quote/whitespace-insensitive containment, so single vs double quotes match. */
  private static lineContainsNeedle(line: string, needles: string[]): boolean {
    const norm = (x: string) => x.replace(/['"`\s]/g, '');
    const nLine = norm(line);
    return needles.some((n) => nLine.includes(norm(n)));
  }

  /** Recursively gather .ts files (skipping node_modules / dist / .d.ts). */
  private static async collectTsFiles(dir: string, out: string[]): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // root doesn't exist — skip silently
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        await AutoPatch.collectTsFiles(full, out);
      } else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  }

  private static unifiedDiff(file: string, line: number, oldLine: string, newLine: string): string {
    return [
      `--- a/${file}`,
      `+++ b/${file}`,
      `@@ line ${line} @@`,
      `-${oldLine}`,
      `+${newLine}`,
    ].join('\n');
  }
}
