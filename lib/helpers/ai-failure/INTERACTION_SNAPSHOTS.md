# Interaction Snapshot & UI Change Analysis

Diagnoses Playwright locator failures caused by UI changes by comparing the
**last successful interaction** ("old info") against the **current DOM** ("new
info") and asking the AI what changed. Analysis-only — it never self-heals or
edits test code. Works with no access to the application source, Git, or any VCS.

## How it works

1. **On every successful interaction** (`click` / `fill` / `selectOption` via
   `BasePage`), `InteractionSnapshotCapture` records a full element fingerprint
   (accessibility, DOM, position, parent context, neighbourhood, semantic path)
   plus an optional cropped screenshot, and upserts it into PostgreSQL keyed by
   `(scenario, step, url, locator)`. Only the **latest** snapshot per locator is
   kept — the table never grows unbounded.

2. **When a locator later fails**, `FailureIntelligenceEngine`:
   - loads the last successful snapshot (progressive relaxation if no exact match),
   - fingerprints the current best candidate from the live DOM,
   - runs `InteractionDiff` to compute what changed (accessible name, role, tag,
     placeholder, parent, position, …),
   - sends the structured old-vs-new comparison (not raw HTML) to Gemini, which
     returns `changeAnalysis` = *what changed · why it failed · the fix*,
   - renders an **Interaction Comparison** section in the Allure report showing
     previous vs current side-by-side, the detected changes, and the AI analysis.

It also catches the **"clicked somewhere else"** case: when a locator resolves to
more than one element (ambiguous) the similarity search now runs too, so the
report surfaces the element you most likely meant.

## Enabling it

The feature degrades to a **no-op** until a database is configured, so tests run
unchanged out of the box. To turn it on, set the `AI_DB_*` vars in
`environments/<env>.env`:

```ini
AI_INTERACTION_SNAPSHOTS=true     # master switch (default true)
AI_DB_HOST=your-pg-host           # blank ⇒ feature stays a no-op
AI_DB_PORT=5432
AI_DB_NAME=ai_failure_store
AI_DB_USER=...
AI_DB_PASSWORD=...
AI_DB_SSL=false
AI_MAX_CANDIDATES=5               # candidates stored + sent to the AI
AI_STORE_SCREENSHOTS=true         # cropped element screenshots (base64 in DB)
```

Use a database **separate** from the application-under-test DB (`DB_*`). All
tables are `ai_`-prefixed and created automatically on first connect
(`db/schema.sql` is provided for manual provisioning).

## Safety / graceful degradation

- A DB outage never fails or blocks a test — every operation is wrapped and
  errors are logged at `warn`/`debug` only.
- If the DB is unreachable at startup the store marks itself unavailable for the
  run and all capture/retrieval becomes a cheap no-op.
- Fingerprint extraction is awaited (so it reflects interaction-time state);
  the DB write is fire-and-forget and flushed in the `After`/`AfterAll` hooks.

## Tables

| Table | Strategy | Bound |
|-------|----------|-------|
| `ai_executions` | upsert on `environment` | 1 / environment |
| `ai_interaction_snapshots` | upsert on `(scenario, step, url, locator)` | 1 / locator |
| `ai_failed_interactions` | upsert on `(scenario, step, url, locator)` | 1 / locator |
| `ai_candidate_matches` | DELETE + INSERT per failure | ≤ `AI_MAX_CANDIDATES` / locator |
| `ai_analysis` | upsert on `failed_interaction_id` | 1 / locator |
