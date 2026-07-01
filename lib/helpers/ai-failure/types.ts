/**
 * AI Failure Intelligence Engine — shared type definitions.
 *
 * The engine assembles a compact {@link FailureIntelligencePackage} (FIP) when a
 * scenario fails. The FIP holds only the information relevant to the failing step,
 * encoded as compact JSON so it can be sent to an LLM with minimal token cost.
 */

import type { Locator } from 'playwright';

// ── 1. Failed action ─────────────────────────────────────────────────────────

export type ActionType =
  | 'click'
  | 'fill'
  | 'select'
  | 'navigate'
  | 'assertion'
  | 'wait'
  | 'unknown';

/** A single user-driven action recorded during the scenario. */
export interface ActionRecord {
  type: ActionType;
  description: string;
  /** String form of the Playwright locator, e.g. `locator('a#submit')`. */
  selector?: string;
  /** Live locator reference — used to re-query the DOM in the After hook. */
  locator?: Locator;
  /** Value supplied to fill/select actions. */
  value?: string;
  timestamp: string;
}

/** The failed step, distilled from Cucumber + the last recorded action. */
export interface FailedAction {
  stepText: string;
  action: ActionType;
  description: string;
  selector?: string;
  timestamp: string;
}

// ── 2. DOM intelligence ──────────────────────────────────────────────────────

export interface ElementState {
  visible: boolean;
  enabled: boolean;
  disabled: boolean;
  editable: boolean;
  checked?: boolean;
}

/** Only the computed styles that influence interactivity. */
export interface InteractionStyles {
  display: string;
  visibility: string;
  opacity: string;
  pointerEvents: string;
  zIndex: string;
}

/** Compact, denoised representation of a single DOM element. */
export interface ElementInfo {
  tag: string;
  text?: string;
  id?: string;
  classes?: string[];
  dataAttributes?: Record<string, string>;
  ariaAttributes?: Record<string, string>;
  role?: string;
  name?: string;
  type?: string;
}

/** Tier 1: Pixel bounding box of the failing element. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tier 5: Accessibility properties used by Playwright's own locator engine. */
export interface A11ySnapshot {
  role?: string;
  /** Computed accessible name: aria-label → labelledby text → title. */
  name?: string;
  label?: string;
  disabled: boolean;
  focused: boolean;
  required?: boolean;
  expanded?: boolean;
}

/**
 * Tier 11: Compact fingerprint of the failing element.
 * Extremely low token cost; almost always sufficient for locator derivation.
 */
export interface ElementFingerprint {
  tag: string;
  role?: string;
  text?: string;
  /** CSS path from body to element, e.g. "main>form>footer>button#checkout". */
  path: string;
  /** Visible text of up to 4 sibling/nearby nodes for disambiguation. */
  nearbyText: string[];
}

/** Tier 12: Parent + siblings + children of the failing element. */
export interface LocalDomWindow {
  parent?: ElementInfo;
  siblings: ElementInfo[];
  children: ElementInfo[];
}

/** Tier 9: High-level semantic inventory of the page's interactive elements. */
export interface SemanticSummary {
  pageTitle?: string;
  buttons: string[];
  inputs: string[];
  forms: string[];
  dialogs: string[];
  headings: string[];
}

/**
 * Intelligent DOM Window — all tiers assembled in a single compact package.
 * Raw HTML is intentionally absent; the structured fields below contain every
 * attribute an LLM needs to diagnose selector failures and interaction issues
 * at a fraction of the token cost of a DOM dump.
 */
export interface DomIntelligenceResult {
  /** Whether the failing locator resolved to exactly one element. */
  resolved: boolean;
  /** Number of elements the locator matched (for ambiguity detection). */
  matchCount: number;

  // Tier 1 — Target element
  element?: ElementInfo;
  state?: ElementState;
  styles?: InteractionStyles;
  boundingBox?: BoundingBox;

  // Tier 3 — Ancestor chain (compact label strings, root → parent)
  ancestorChain?: string[];

  // Tier 5 — Accessibility snapshot
  a11y?: A11ySnapshot;

  // Tier 11 — Element fingerprint
  fingerprint?: ElementFingerprint;

  // Tier 12 — Local DOM window (parent + siblings + children)
  localWindow?: LocalDomWindow;

  // Tier 4 — Blocking overlay covering the target
  blockingOverlay?: { tag: string; classes?: string[]; zIndex: string };

  // Tier 9 — Semantic page summary
  semanticSummary?: SemanticSummary;

  // Tier 7 — Compressed DOM tree rooted at nearest meaningful ancestor
  domTree?: string;

  /**
   * Accessibility tree (Playwright ariaSnapshot YAML) — the browser-computed
   * role + accessible name for each node. This is the authoritative source the
   * SimilarityEngine uses to find role/name candidates, surfaced for the human.
   */
  a11yTree?: string;

  /** Populated when extraction failed (e.g. element not found). */
  error?: string;
}

// ── 3. Supporting evidence ───────────────────────────────────────────────────

export interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: string;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  failure?: string;
  timestamp: string;
}

export interface BrowserInfo {
  name: string;
  headless: boolean;
  viewport?: { width: number; height: number } | null;
  url?: string;
}

export interface EnvironmentInfo {
  testEnv: string;
  baseUrl?: string;
  ci: boolean;
  platform: string;
  nodeVersion: string;
}

export interface SupportingEvidence {
  /** Full-page screenshot, base64-encoded PNG (omitted from the LLM payload). */
  screenshotBase64?: string;
  /** Optional element-only screenshot, base64-encoded PNG. */
  elementScreenshotBase64?: string;
  /**
   * Full-page screenshot with a highlight rectangle drawn over where the verified
   * suggested locator actually resolves. Produced after locator validation.
   */
  annotatedScreenshotBase64?: string;
  /** Complete HTML page DOM dump. */
  wholeDomHtml?: string;
  consoleLogs: ConsoleEntry[];
  networkRequests: NetworkEntry[];
  networkFailures: NetworkEntry[];
  stackTrace?: string;
  /** Playwright "Call log:" section parsed from the error message. */
  playwrightCallLog?: string[];
  browser: BrowserInfo;
  environment: EnvironmentInfo;
}

// ── 4. Element similarity candidates ─────────────────────────────────────────

/**
 * A single candidate element found by the Similarity Engine when the primary
 * locator fails to resolve. Score is 0–99 (evidence-strength, not probability).
 */
export interface SimilarityCandidate {
  /** Normalised similarity score 0–99. */
  score: number;
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  role?: string;
  placeholder?: string;
  dataTestId?: string;
  ariaLabel?: string;
  /** Ready-to-paste Playwright locator for this candidate. */
  suggestedLocator: string;
  /** Human-readable list of properties that contributed to the score. */
  matchReasons: string[];
}

// ── 5. Rule-based evidence engine ────────────────────────────────────────────

export interface EvidencePoint {
  /** Human-readable evidence statement. */
  label: string;
  /** Whether this evidence was observed (✓) or not (✗). */
  present: boolean;
  /** Score contribution when present. */
  weight: number;
}

export interface RootCauseCandidate {
  title: string;
  /** Confidence score 0–99, derived from weighted evidence. */
  confidence: number;
  rawScore: number;
  evidence: EvidencePoint[];
}

// ── 5. AI analysis ───────────────────────────────────────────────────────────

export interface AlternativeCause {
  cause: string;
  confidence: number;
}

export interface AiAnalysis {
  available: boolean;
  rootCause?: string;
  explanation?: string;
  confidence?: number;
  confidenceLevel?: string;
  alternativeCauses?: AlternativeCause[];
  timeline?: string[];
  appFixes?: string[];
  automationImprovements?: string[];
  betterLocator?: string;
  /** Why the AI chose betterLocator over the other candidates. */
  betterLocatorReason?: string;
  /** One-line AI assessment per candidate locator (keyed by locator string). */
  candidateAssessments?: { locator: string; note: string }[];
  stabilityRecommendations?: string[];
  issueClassification?: string;
  rootCauseCategory?: string;
  isFlaky?: boolean;
  debuggingChecklist?: string[];
  /** Why each ranked confidence score is high or low. */
  scoreExplanations?: Record<string, string>;
  /**
   * UI-change analysis produced from the InteractionComparison (old info vs new
   * info). Present only when a prior successful snapshot was found and compared
   * against the current DOM.
   */
  changeAnalysis?: ChangeAnalysis;
  /** Raw model text when structured parsing failed. */
  raw?: string;
  /** Populated when the AI call was skipped or errored. */
  error?: string;
}

/** AI explanation of a UI change that broke a previously-working locator. */
export interface ChangeAnalysis {
  /** What specifically changed, citing detectedChanges values. */
  whatChanged?: string;
  /** Why the change caused this particular locator to fail. */
  whyCausedFailure?: string;
  /** The exact updated locator (matches betterLocator). */
  fix?: string;
}

// ── 6. Selector diff (pre-computed before the AI call) ───────────────────────

/**
 * A structured comparison between what the failing selector was looking for and
 * what the SimilarityEngine found in the live DOM. Computed entirely on the Node
 * side before Gemini is called, so the LLM receives a clean diff rather than raw
 * HTML and is not asked to re-derive a locator from scratch.
 */
export interface SelectorDiff {
  /** The failing selector string as recorded by BasePage.track(). */
  failingSelector: string;
  /** Key attributes extracted from the failing selector (tag, id, role, etc.). */
  parsedTarget: Record<string, string>;
  /**
   * Best Playwright locator derived from the live DOM by the SimilarityEngine.
   * Only set when similarityCandidates[0].score >= 60.
   */
  preComputedLocator?: string;
  /** Key attributes of the top similarity candidate (what the DOM actually has). */
  topCandidateAttributes?: Record<string, string>;
  /**
   * Human-readable hints describing the specific gap between the failing selector
   * and the actual DOM (e.g. "id has 1-char typo: 'NewAcount' → 'NewAccount'").
   */
  differenceHints: string[];
  /**
   * Result of running the suggested locator back against the live page to confirm
   * it resolves. Promotes the suggestion from "scored guess" to "verified fix".
   */
  locatorValidation?: LocatorValidation;
  /**
   * The full set of ranked candidates (each validated against the live DOM) sent
   * to the AI so it can pick the best one. The headline locator is the AI's pick
   * (or the top verified candidate); the rest are shown as alternatives.
   */
  candidates?: CandidateValidation[];
}

/** A similarity candidate enriched with its live-DOM validation result. */
export interface CandidateValidation {
  /** Ready-to-paste Playwright locator. */
  locator: string;
  /** SimilarityEngine score 0–99. */
  score: number;
  /** How many elements it resolved to on the live page. */
  matchCount: number;
  /** 'verified' = exactly 1, 'ambiguous' = >1, 'unresolved' = 0, 'error' = threw. */
  status: 'verified' | 'ambiguous' | 'unresolved' | 'error';
  /** Properties that contributed to the similarity score. */
  matchReasons: string[];
}

/** Outcome of executing a suggested locator against the live page. */
export interface LocatorValidation {
  /** The locator string that was tested. */
  locator: string;
  /** How many elements it resolved to on the live page. */
  matchCount: number;
  /** 'verified' = exactly 1, 'ambiguous' = >1, 'unresolved' = 0, 'error' = threw. */
  status: 'verified' | 'ambiguous' | 'unresolved' | 'error';
  /** Error message when status === 'error'. */
  error?: string;
}

// ── 7. Auto-patch suggestion ─────────────────────────────────────────────────

/**
 * A ready-to-apply source edit that replaces the failing locator in its page
 * object with the verified fix. Located by scanning the page-object sources for
 * the failing selector literal. Shown as a copy-paste diff — never auto-written.
 */
export interface PatchSuggestion {
  /** Project-relative path to the page object file. */
  file: string;
  /** 1-based line number of the failing locator. */
  line: number;
  /** The current source line (what to remove). */
  oldLine: string;
  /** The proposed source line (what to add). */
  newLine: string;
  /** A unified-diff snippet ready to paste/review. */
  diff: string;
}

// ── Assembled package ────────────────────────────────────────────────────────

export interface FailureIntelligencePackage {
  scenarioName: string;
  failedAction: FailedAction;
  errorMessage: string;
  dom: DomIntelligenceResult;
  evidence: SupportingEvidence;
  /** Top similar elements found when the primary locator failed to resolve. */
  similarityCandidates: SimilarityCandidate[];
  rankedRootCauses: RootCauseCandidate[];
  /**
   * Pre-computed selector diff: what the test expected vs what the DOM has.
   * Populated whenever similarityCandidates is non-empty.
   */
  selectorDiff?: SelectorDiff;
  /**
   * Ready-to-apply source edit replacing the failing locator with the verified
   * fix. Present only when the failing selector was located in a page object and
   * a verified replacement exists. Shown as a diff — never auto-applied.
   */
  patchSuggestion?: PatchSuggestion;
  /**
   * "Old info vs new info" comparison: the last successful interaction snapshot
   * for this locator vs the current DOM. Populated only when a prior snapshot
   * exists in the database and could be loaded. Drives ai.changeAnalysis.
   */
  interactionComparison?: InteractionComparison;
  ai: AiAnalysis;
}

// ── 8. Interaction snapshot & UI change analysis ─────────────────────────────

/** Accessibility properties captured for a successfully-interacted element. */
export interface FingerprintA11y {
  role?: string;
  accessibleName?: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean;
  required?: boolean;
  readonly?: boolean;
}

/** DOM properties captured for the element. */
export interface FingerprintDom {
  tag: string;
  id?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  text?: string;
  placeholder?: string;
  title?: string;
  ariaAttributes?: Record<string, string>;
  inputType?: string;
  name?: string;
  value?: string;
}

/** Position + structural placement of the element. */
export interface FingerprintPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  domDepth: number;
  siblingIndex: number;
}

/** A single ancestor descriptor in the parent chain (root-most last). */
export interface FingerprintParent {
  tag: string;
  role?: string;
  accessibleName?: string;
}

/** Surrounding semantic context, for disambiguation. */
export interface FingerprintNeighbourhood {
  previousSibling?: string;
  nextSibling?: string;
  nearbyLabels: string[];
  nearbyHeadings: string[];
  nearbyButtons: string[];
  nearbyTextboxes: string[];
}

/**
 * Complete identity of an element at interaction time. Stored as JSONB in
 * interaction_snapshots and used by the InteractionDiff engine to detect what
 * changed when the same locator later fails.
 */
export interface InteractionFingerprint {
  a11y: FingerprintA11y;
  dom: FingerprintDom;
  position: FingerprintPosition;
  /** Parent chain, nearest parent first (up to ~2 levels). */
  parents: FingerprintParent[];
  neighbourhood: FingerprintNeighbourhood;
  /** Semantic path using role + accessible name, e.g. "main → form(Login) → button(Login)". */
  semanticPath: string;
}

/** A persisted successful interaction, retrieved when its locator later fails. */
export interface InteractionSnapshot {
  scenarioName: string;
  stepText: string;
  url: string;
  locatorString: string;
  actionType: string;
  locatorStrategy?: string;
  fingerprint: InteractionFingerprint;
  screenshotBase64?: string;
  capturedAt: string;
}

/** A single detected difference between the previous snapshot and the current element. */
export interface DiffResult {
  /** e.g. "accessibleName", "role", "placeholder", "parentName", "position", "tag". */
  field: string;
  from: string;
  to: string;
  /** Magnitude 0–1 (1 = completely changed) — used to rank which change mattered most. */
  severity: number;
}

/** Compact fingerprint summary sent to the AI and rendered in the report. */
export interface FingerprintSummary {
  role?: string;
  accessibleName?: string;
  tag: string;
  text?: string;
  placeholder?: string;
  parentRole?: string;
  parentName?: string;
  semanticPath: string;
}

/**
 * The "old info vs new info" bundle. Built on failure by loading the last
 * successful snapshot and comparing it against the best current candidate.
 */
export interface InteractionComparison {
  /** 1 = exact match, up to 5 = locator-only fallback. */
  retrievalLevel: number;
  /** ISO timestamp of the baseline snapshot. */
  baselineDate?: string;
  /** Previous successful element. */
  previous?: FingerprintSummary;
  /** Current best candidate (or resolved element). */
  current?: FingerprintSummary;
  /** Ready-to-paste locator for the current best candidate. */
  suggestedLocator?: string;
  /** Structured list of measured differences (highest severity first). */
  detectedChanges: DiffResult[];
  /** Previous element screenshot (from the snapshot), base64 PNG. */
  previousScreenshotBase64?: string;
  /** Current element screenshot, base64 PNG. */
  currentScreenshotBase64?: string;
  /** Human note, e.g. "No baseline available" or "partial match (level 3)". */
  note?: string;
  /**
   * True when a DB baseline exists for this locator but the element cannot be
   * found anywhere in the current DOM. Indicates a section/element was removed
   * from the application rather than just renamed or moved.
   */
  elementGone?: boolean;
}
