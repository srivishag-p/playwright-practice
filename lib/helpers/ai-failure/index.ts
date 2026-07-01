/**
 * AI Failure Intelligence Engine — public barrel.
 *
 * On a UI scenario failure the engine assembles a compact Failure Intelligence
 * Package (failed action → DOM intelligence → evidence → deterministic rule
 * scoring → Gemini analysis) and publishes an enhanced report to Allure.
 *
 * Wiring:
 *   - BasePage records actions via FailureContext.recordAction
 *   - CustomWorld attaches console/network listeners (FailureContext.attachListeners)
 *   - ui.hooks BeforeStep calls FailureContext.for(page).setCurrentStep
 *   - ui.hooks After (on FAILED) calls FailureIntelligenceEngine.run
 */

export { FailureIntelligenceEngine } from './FailureIntelligenceEngine';
export type { FailureWorldLike } from './FailureIntelligenceEngine';
export { FailureContext, inferActionType } from './FailureContext';
export { DomIntelligence } from './DomIntelligence';
export { EvidenceCollector } from './EvidenceCollector';
export { RuleEngine } from './RuleEngine';
export { SimilarityEngine } from './SimilarityEngine';
export { GeminiClient } from './GeminiClient';
export { ReportRenderer } from './ReportRenderer';
export { SelfHealer } from './SelfHealer';
export type { HealResult } from './SelfHealer';
export { AutoPatch } from './AutoPatch';
export { locatorFromString } from './locatorFromString';

// ── Interaction Snapshot & UI Change Analysis ────────────────────────────────
export { AiDbClient } from './db/AiDbClient';
export { InteractionSnapshotCapture } from './InteractionSnapshotCapture';
export type { CaptureContext } from './InteractionSnapshotCapture';
export { InteractionSnapshotRepo } from './InteractionSnapshotRepo';
export type { SnapshotKey, RetrievedSnapshot } from './InteractionSnapshotRepo';
export { InteractionDiff } from './InteractionDiff';
export { levenshtein, stringSimilarity, urlKey } from './utils';

export * from './types';
