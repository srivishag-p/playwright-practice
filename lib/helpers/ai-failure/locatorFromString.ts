/**
 * locatorFromString — translate a `page.getByX('…')` / `page.locator('…')`
 * suggestion string (as produced by SimilarityEngine) back into a real Locator.
 *
 * Deliberately a small whitelist parser — never eval — covering exactly the
 * forms the engine emits. Returns undefined for anything it doesn't recognise.
 */

import type { Locator, Page } from 'playwright';

export function locatorFromString(page: Page, s: string): Locator | undefined {
  const str = s.trim();
  let m: RegExpMatchArray | null;
  if ((m = str.match(/^page\.getByTestId\(['"`](.+?)['"`]\)$/)))      return page.getByTestId(m[1]);
  if ((m = str.match(/^page\.getByPlaceholder\(['"`](.+?)['"`]\)$/))) return page.getByPlaceholder(m[1]);
  if ((m = str.match(/^page\.getByLabel\(['"`](.+?)['"`]\)$/)))       return page.getByLabel(m[1]);
  if ((m = str.match(/^page\.getByText\(['"`](.+?)['"`]\)$/)))        return page.getByText(m[1]);
  if ((m = str.match(/^page\.getByTitle\(['"`](.+?)['"`]\)$/)))       return page.getByTitle(m[1]);
  if ((m = str.match(/^page\.getByRole\(['"`]([^'"`]+)['"`](?:\s*,\s*\{\s*name:\s*['"`](.+?)['"`]\s*\})?\)$/))) {
    return m[2]
      ? page.getByRole(m[1] as Parameters<Page['getByRole']>[0], { name: m[2] })
      : page.getByRole(m[1] as Parameters<Page['getByRole']>[0]);
  }
  if ((m = str.match(/^page\.locator\(['"`](.+?)['"`]\)$/)))          return page.locator(m[1]);
  return undefined;
}
