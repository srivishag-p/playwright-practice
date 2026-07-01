/**
 * AiDbClient — SQLite store for the AI Failure Intelligence interaction history.
 *
 * Uses better-sqlite3 (synchronous API) so there are no async/await chains in
 * the hot path. The public surface is intentionally minimal:
 *   run()  — fire a write statement, returns true on success
 *   all()  — SELECT returning all rows
 *   get()  — SELECT returning the first row or undefined
 *   newId()— generates a UUID to use as a primary key
 *
 * Core guarantee — GRACEFUL DEGRADATION:
 *   The database is enhancement infrastructure. It must NEVER fail or block a
 *   test. Every public method swallows its own errors. If the DB cannot be
 *   opened, the client enters an `unavailable` state and all operations become
 *   cheap no-ops.
 *
 * Config (environments/<env>.env):
 *   AI_INTERACTION_SNAPSHOTS — "false" to disable the whole feature (default true)
 *   AI_DB_PATH               — path to the .db file
 *                              (default: <cwd>/ai-store.db)
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getEnvBool } from '@utils/env';
import { logger } from '@utils/logger';

type State = 'uninitialised' | 'ready' | 'unavailable';

export class AiDbClient {
  private static db: Database.Database | undefined;
  private static state: State = 'uninitialised';
  private static initPromise: Promise<boolean> | undefined;
  /** In-flight fire-and-forget writes, awaited by flush(). */
  private static pending = new Set<Promise<unknown>>();

  /** Master switch — the feature flag must be enabled. */
  static isFeatureEnabled(): boolean {
    return getEnvBool('AI_INTERACTION_SNAPSHOTS', true);
  }

  /**
   * Lazily open the database and bootstrap the schema. Returns true when the
   * store is usable, false otherwise. Safe to call repeatedly.
   */
  static async ready(): Promise<boolean> {
    if (this.state === 'ready') return true;
    if (this.state === 'unavailable') return false;
    if (!this.initPromise) this.initPromise = this.init();
    return this.initPromise;
  }

  private static async init(): Promise<boolean> {
    if (!this.isFeatureEnabled()) {
      this.state = 'unavailable';
      logger.debug('[AiDbClient] AI_INTERACTION_SNAPSHOTS=false — interaction store disabled');
      return false;
    }

    try {
      const dbPath = this.dbPath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.bootstrapSchema();
      this.state = 'ready';
      logger.info(`[AiDbClient] interaction store ready → ${dbPath}`);
      return true;
    } catch (err) {
      this.state = 'unavailable';
      logger.warn(`[AiDbClient] could not open DB — interaction store disabled (tests unaffected): ${(err as Error).message}`);
      this.db = undefined;
      return false;
    }
  }

  private static dbPath(): string {
    return process.env.AI_DB_PATH?.trim() ?? path.resolve(process.cwd(), 'ai-store.db');
  }

  // ── Query helpers ───────────────────────────────────────────────────────────

  /** Execute a write statement. Returns true on success. */
  static run(sql: string, params: unknown[] = []): boolean {
    if (this.state !== 'ready' || !this.db) return false;
    try {
      this.db.prepare(sql).run(params);
      return true;
    } catch (err) {
      logger.warn(`[AiDbClient] run failed (ignored): ${(err as Error).message}`);
      return false;
    }
  }

  /** Execute a SELECT and return all matching rows. */
  static all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    if (this.state !== 'ready' || !this.db) return [];
    try {
      return this.db.prepare(sql).all(params) as T[];
    } catch (err) {
      logger.warn(`[AiDbClient] query failed (ignored): ${(err as Error).message}`);
      return [];
    }
  }

  /** Execute a SELECT and return the first row, or undefined. */
  static get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    if (this.state !== 'ready' || !this.db) return undefined;
    try {
      return this.db.prepare(sql).get(params) as T | undefined;
    } catch (err) {
      logger.warn(`[AiDbClient] query failed (ignored): ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Generate a new UUID for use as a primary key. */
  static newId(): string {
    return randomUUID();
  }

  // ── Fire-and-forget write queue ─────────────────────────────────────────────

  /**
   * Enqueue a fire-and-forget write. Tracked so flush() can drain it before
   * the scenario tears down. Errors are swallowed.
   */
  static enqueueWrite(work: () => Promise<unknown>): void {
    if (this.state === 'unavailable') return;
    const p = (async () => {
      try {
        if (!(await this.ready())) return;
        await work();
      } catch (err) {
        logger.warn(`[AiDbClient] write failed (ignored): ${(err as Error).message}`);
      }
    })();
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Await all in-flight writes. Call from an After hook. */
  static async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    await Promise.allSettled([...this.pending]);
  }

  /** Close the database. Call from AfterAll. */
  static async close(): Promise<void> {
    await this.flush();
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
    this.state = 'uninitialised';
    this.initPromise = undefined;
  }

  // ── Schema bootstrap ────────────────────────────────────────────────────────

  private static bootstrapSchema(): void {
    if (!this.db) return;
    this.db.exec(AiDbClient.SCHEMA_SQL);
  }

  private static readonly SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ai_executions (
  id           TEXT PRIMARY KEY,
  build_id     TEXT,
  browser      TEXT,
  environment  TEXT UNIQUE,
  started_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ai_interaction_snapshots (
  id                TEXT PRIMARY KEY,
  execution_id      TEXT REFERENCES ai_executions(id),
  scenario_name     TEXT NOT NULL,
  step_text         TEXT NOT NULL,
  url               TEXT NOT NULL,
  locator_string    TEXT NOT NULL,
  action_type       TEXT,
  locator_strategy  TEXT,
  fingerprint       TEXT,
  screenshot_base64 TEXT,
  captured_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ai_snapshots_unique UNIQUE (scenario_name, step_text, url, locator_string)
);

CREATE TABLE IF NOT EXISTS ai_failed_interactions (
  id                  TEXT PRIMARY KEY,
  execution_id        TEXT REFERENCES ai_executions(id),
  matched_snapshot_id TEXT REFERENCES ai_interaction_snapshots(id),
  scenario_name       TEXT NOT NULL,
  step_text           TEXT NOT NULL,
  url                 TEXT NOT NULL,
  locator_string      TEXT NOT NULL,
  error_message       TEXT,
  stack_trace         TEXT,
  current_fingerprint TEXT,
  failed_at           TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ai_failed_unique UNIQUE (scenario_name, step_text, url, locator_string)
);

CREATE TABLE IF NOT EXISTS ai_candidate_matches (
  id                    TEXT PRIMARY KEY,
  failed_interaction_id TEXT REFERENCES ai_failed_interactions(id) ON DELETE CASCADE,
  rank                  INTEGER,
  suggested_locator     TEXT,
  overall_score         INTEGER,
  score_breakdown       TEXT,
  validation_status     TEXT,
  match_count           INTEGER,
  fingerprint           TEXT
);

CREATE TABLE IF NOT EXISTS ai_analysis (
  id                    TEXT PRIMARY KEY,
  failed_interaction_id TEXT UNIQUE REFERENCES ai_failed_interactions(id) ON DELETE CASCADE,
  structured_input      TEXT,
  structured_output     TEXT,
  model                 TEXT,
  latency_ms            INTEGER,
  confidence            INTEGER,
  called_at             TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;
}
