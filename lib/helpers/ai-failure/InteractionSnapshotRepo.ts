/**
 * InteractionSnapshotRepo — all reads/writes against the AI interaction store.
 *
 * Storage strategy: every table is bounded — no unbounded growth.
 *   - ai_interaction_snapshots : upsert on (scenario, step, url, locator)
 *   - ai_failed_interactions   : upsert on (scenario, step, url, locator)
 *   - ai_candidate_matches     : DELETE + INSERT per failed interaction (top N)
 *   - ai_analysis              : upsert on failed_interaction_id
 *   - ai_executions            : upsert on environment
 *
 * Every method goes through AiDbClient, which no-ops when the store is
 * unavailable, so callers never need their own try/catch for DB outages.
 */

import { AiDbClient } from './db/AiDbClient';
import type {
  CandidateValidation,
  InteractionFingerprint,
  InteractionSnapshot,
} from './types';

/** Identity used to store and retrieve a snapshot. */
export interface SnapshotKey {
  scenarioName: string;
  stepText: string;
  url: string;
  locatorString: string;
}

export interface RetrievedSnapshot {
  snapshot: InteractionSnapshot;
  /** Snapshot row id, for linking failed_interactions.matched_snapshot_id. */
  id: string;
  /** 1 = exact match … 5 = locator-only fallback. */
  retrievalLevel: number;
}

interface SnapshotRow {
  id: string;
  scenario_name: string;
  step_text: string;
  url: string;
  locator_string: string;
  action_type: string;
  locator_strategy: string | null;
  fingerprint: string | null;
  screenshot_base64: string | null;
  captured_at: string;
}

export class InteractionSnapshotRepo {
  private static executionId: Promise<string | undefined> | undefined;

  // ── Executions ─────────────────────────────────────────────────────────────

  /** Upsert the current execution row (one per environment) and cache its id. */
  static async ensureExecution(): Promise<string | undefined> {
    if (!this.executionId) this.executionId = this.upsertExecution();
    return this.executionId;
  }

  private static async upsertExecution(): Promise<string | undefined> {
    if (!(await AiDbClient.ready())) return undefined;

    const environment = process.env.TEST_ENV ?? 'dev';
    const browser = process.env.BROWSER ?? 'chromium';
    const buildId =
      process.env.BUILD_ID ?? process.env.GITHUB_RUN_ID ?? process.env.CI_PIPELINE_ID ?? null;

    const newId = AiDbClient.newId();
    AiDbClient.run(
      `INSERT INTO ai_executions (id, environment, browser, build_id, started_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(environment) DO UPDATE SET
         browser    = excluded.browser,
         build_id   = excluded.build_id,
         started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [newId, environment, browser, buildId]
    );
    const row = AiDbClient.get<{ id: string }>(
      'SELECT id FROM ai_executions WHERE environment = ?',
      [environment]
    );
    return row?.id;
  }

  // ── Snapshots ───────────────────────────────────────────────────────────────

  /** Upsert one snapshot row, keeping only the latest per locator. */
  static async upsertSnapshot(snapshot: InteractionSnapshot): Promise<void> {
    const executionId = await this.ensureExecution();
    AiDbClient.run(
      `INSERT INTO ai_interaction_snapshots
         (id, execution_id, scenario_name, step_text, url, locator_string,
          action_type, locator_strategy, fingerprint, screenshot_base64, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(scenario_name, step_text, url, locator_string) DO UPDATE SET
         execution_id      = excluded.execution_id,
         action_type       = excluded.action_type,
         locator_strategy  = excluded.locator_strategy,
         fingerprint       = excluded.fingerprint,
         screenshot_base64 = excluded.screenshot_base64,
         captured_at       = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [
        AiDbClient.newId(),
        executionId ?? null,
        snapshot.scenarioName,
        snapshot.stepText,
        snapshot.url,
        snapshot.locatorString,
        snapshot.actionType,
        snapshot.locatorStrategy ?? null,
        JSON.stringify(snapshot.fingerprint),
        snapshot.screenshotBase64 ?? null,
      ]
    );
  }

  /**
   * Find the most recent successful snapshot for a failing locator, relaxing
   * the match progressively until a row is found.
   */
  static async findLatest(key: SnapshotKey): Promise<RetrievedSnapshot | undefined> {
    if (!(await AiDbClient.ready())) return undefined;

    const levels: Array<{ where: string; params: unknown[] }> = [
      { where: 'scenario_name = ? AND step_text = ? AND url = ? AND locator_string = ?',
        params: [key.scenarioName, key.stepText, key.url, key.locatorString] },
      { where: 'scenario_name = ? AND step_text = ? AND url = ?',
        params: [key.scenarioName, key.stepText, key.url] },
      { where: 'step_text = ? AND url = ? AND locator_string = ?',
        params: [key.stepText, key.url, key.locatorString] },
      { where: 'url = ? AND locator_string = ?',
        params: [key.url, key.locatorString] },
      { where: 'locator_string = ?',
        params: [key.locatorString] },
    ];

    for (let i = 0; i < levels.length; i++) {
      const { where, params } = levels[i];
      const row = AiDbClient.get<SnapshotRow>(
        `SELECT * FROM ai_interaction_snapshots WHERE ${where} ORDER BY captured_at DESC LIMIT 1`,
        params
      );
      if (row) {
        return { snapshot: this.rowToSnapshot(row), id: row.id, retrievalLevel: i + 1 };
      }
    }
    return undefined;
  }

  private static rowToSnapshot(r: SnapshotRow): InteractionSnapshot {
    return {
      scenarioName: r.scenario_name,
      stepText: r.step_text,
      url: r.url,
      locatorString: r.locator_string,
      actionType: r.action_type,
      locatorStrategy: r.locator_strategy ?? undefined,
      fingerprint: r.fingerprint ? (JSON.parse(r.fingerprint) as InteractionFingerprint) : ({} as InteractionFingerprint),
      screenshotBase64: r.screenshot_base64 ?? undefined,
      capturedAt: r.captured_at,
    };
  }

  // ── Failure persistence ───────────────────────────────────────────────────

  /** Upsert the failed interaction; returns its stable row id for linking. */
  static async upsertFailedInteraction(input: {
    key: SnapshotKey;
    errorMessage?: string;
    stackTrace?: string;
    currentFingerprint?: InteractionFingerprint;
    matchedSnapshotId?: string;
  }): Promise<string | undefined> {
    const executionId = await this.ensureExecution();
    const newId = AiDbClient.newId();
    AiDbClient.run(
      `INSERT INTO ai_failed_interactions
         (id, execution_id, matched_snapshot_id, scenario_name, step_text, url, locator_string,
          error_message, stack_trace, current_fingerprint, failed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(scenario_name, step_text, url, locator_string) DO UPDATE SET
         execution_id        = excluded.execution_id,
         matched_snapshot_id = excluded.matched_snapshot_id,
         error_message       = excluded.error_message,
         stack_trace         = excluded.stack_trace,
         current_fingerprint = excluded.current_fingerprint,
         failed_at           = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [
        newId,
        executionId ?? null,
        input.matchedSnapshotId ?? null,
        input.key.scenarioName,
        input.key.stepText,
        input.key.url,
        input.key.locatorString,
        input.errorMessage ?? null,
        input.stackTrace ?? null,
        input.currentFingerprint ? JSON.stringify(input.currentFingerprint) : null,
      ]
    );
    const row = AiDbClient.get<{ id: string }>(
      'SELECT id FROM ai_failed_interactions WHERE scenario_name = ? AND step_text = ? AND url = ? AND locator_string = ?',
      [input.key.scenarioName, input.key.stepText, input.key.url, input.key.locatorString]
    );
    return row?.id;
  }

  /** Replace the candidate set for a failed interaction (DELETE + INSERT top N). */
  static async replaceCandidates(failedId: string, candidates: CandidateValidation[]): Promise<void> {
    AiDbClient.run('DELETE FROM ai_candidate_matches WHERE failed_interaction_id = ?', [failedId]);
    let rank = 1;
    for (const c of candidates) {
      AiDbClient.run(
        `INSERT INTO ai_candidate_matches
           (id, failed_interaction_id, rank, suggested_locator, overall_score,
            score_breakdown, validation_status, match_count, fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          AiDbClient.newId(),
          failedId,
          rank++,
          c.locator,
          c.score,
          JSON.stringify({ matchReasons: c.matchReasons }),
          c.status,
          c.matchCount,
        ]
      );
    }
  }

  /** Upsert the AI analysis record for a failed interaction. */
  static async upsertAiAnalysis(failedId: string, input: {
    structuredInput: unknown;
    structuredOutput: unknown;
    model: string;
    latencyMs?: number;
    confidence?: number;
  }): Promise<void> {
    AiDbClient.run(
      `INSERT INTO ai_analysis
         (id, failed_interaction_id, structured_input, structured_output,
          model, latency_ms, confidence, called_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(failed_interaction_id) DO UPDATE SET
         structured_input  = excluded.structured_input,
         structured_output = excluded.structured_output,
         model             = excluded.model,
         latency_ms        = excluded.latency_ms,
         confidence        = excluded.confidence,
         called_at         = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [
        AiDbClient.newId(),
        failedId,
        JSON.stringify(input.structuredInput ?? null),
        JSON.stringify(input.structuredOutput ?? null),
        input.model,
        input.latencyMs ?? null,
        input.confidence ?? null,
      ]
    );
  }
}
