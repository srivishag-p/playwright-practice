/**
 * ReportRenderer — turns a {@link FailureIntelligencePackage} into a single,
 * self-contained HTML document that Allure renders as a text/html attachment.
 *
 * Sections (in order):
 *   1. Environment bar           — browser, URL, viewport, env, CI
 *   2. Failure summary           — scenario, step, action, locator, timestamp
 *   3. AI recommendation         — root cause + explanation
 *   4. Ranked root causes        — confidence bars + ✓/✗ evidence
 *   5. AI suggested fixes        — locator, app fixes, automation, stability
 *   6. DOM intelligence          — state, styles, attributes, siblings, hierarchy
 *   7. Console logs              — errors + warnings
 *   8. Network activity          — failures + full request table
 *   9. Stack trace               — error message + Playwright call log
 */

import type {
  FailureIntelligencePackage,
  RootCauseCandidate,
  ElementInfo,
  ElementFingerprint,
  A11ySnapshot,
  SemanticSummary,
  LocalDomWindow,
  SimilarityCandidate,
  NetworkEntry,
} from './types';

export class ReportRenderer {
  /**
   * AI Failure Analysis attachment — focused on AI output only.
   * DOM, logs, network, stack trace and similarity candidates each have
   * their own dedicated attachments, so this report does not repeat them.
   */
  static html(pkg: FailureIntelligencePackage): string {
    return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1e21;line-height:1.5;max-width:960px">
  ${ReportRenderer.envBar(pkg)}
  ${ReportRenderer.summary(pkg)}
  ${ReportRenderer.selectorDiffSection(pkg)}
  ${ReportRenderer.patchSection(pkg)}
  ${ReportRenderer.aiRecommendation(pkg)}
  ${ReportRenderer.timelineSection(pkg)}
  ${ReportRenderer.rootCauses(pkg.rankedRootCauses, pkg)}
  ${ReportRenderer.aiSuggestions(pkg)}
  <p style="margin-top:24px;font-size:11px;color:#90949c">
    Confidence values are evidence-strength scores produced by a deterministic rule engine — not statistical probabilities.
    DOM context, network activity, console logs, and call log are in their own attachments.
  </p>
</div>`.trim();
  }

  // ── Standalone attachment renderers (called from FailureIntelligenceEngine) ──

  /** Standalone DOM Context attachment — structured tiers, no raw HTML. */
  static domHtml(pkg: FailureIntelligencePackage): string {
    const dom = pkg.dom;
    const errorNote = dom.error
      ? `<p class="error-note">⚠️ DOM extraction note: ${esc(dom.error)}</p>` : '';

    const fingerprintBlock = dom.fingerprint
      ? `<section>
           <h2>🪪 Element Fingerprint</h2>
           <table class="info-table">
             <tr><td>tag</td><td><code>&lt;${esc(dom.fingerprint.tag)}&gt;</code></td></tr>
             ${dom.fingerprint.role  ? `<tr><td>role</td><td><code>${esc(dom.fingerprint.role)}</code></td></tr>` : ''}
             ${dom.fingerprint.text  ? `<tr><td>text</td><td>${esc(dom.fingerprint.text)}</td></tr>` : ''}
             <tr><td>CSS path</td><td><code style="font-size:11px">${esc(dom.fingerprint.path)}</code></td></tr>
             ${dom.boundingBox ? `<tr><td>bounding box</td><td><code>${dom.boundingBox.width}×${dom.boundingBox.height} at (${dom.boundingBox.x}, ${dom.boundingBox.y})</code></td></tr>` : ''}
             ${dom.fingerprint.nearbyText.length ? `<tr><td>nearby text</td><td>${dom.fingerprint.nearbyText.map((t) => `<span style="background:#f0f2f5;border-radius:4px;padding:1px 6px;margin-right:4px;font-size:12px">${esc(t)}</span>`).join('')}</td></tr>` : ''}
           </table>
         </section>`
      : `<section><h2>🪪 Element Fingerprint</h2><p class="muted">Locator did not resolve — no element captured.</p></section>`;

    const a11yBlock = dom.a11y
      ? `<section>
           <h2>♿ Accessibility Snapshot</h2>
           <table class="info-table">
             ${dom.a11y.role     ? `<tr><td>role</td><td><code>${esc(dom.a11y.role)}</code></td></tr>` : ''}
             ${dom.a11y.name     ? `<tr><td>accessible name</td><td>${esc(dom.a11y.name)}</td></tr>` : ''}
             ${dom.a11y.label    ? `<tr><td>aria-label</td><td>${esc(dom.a11y.label)}</td></tr>` : ''}
             <tr><td>disabled</td><td style="color:${dom.a11y.disabled ? '#b71c1c' : '#1a7f37'};font-weight:600">${dom.a11y.disabled}</td></tr>
             <tr><td>focused</td><td><code>${dom.a11y.focused}</code></td></tr>
             ${dom.a11y.required !== undefined ? `<tr><td>required</td><td><code>${dom.a11y.required}</code></td></tr>` : ''}
             ${dom.a11y.expanded !== undefined ? `<tr><td>aria-expanded</td><td><code>${dom.a11y.expanded}</code></td></tr>` : ''}
           </table>
         </section>` : '';

    const ancestorBlock = dom.ancestorChain?.length
      ? `<section>
           <h2>🧬 Ancestor Chain</h2>
           <div style="font-family:monospace;font-size:12px;line-height:1.8">
             ${dom.ancestorChain.map((seg, i) => `<div>${'&nbsp;'.repeat(i * 2)}└ ${esc(seg)}</div>`).join('')}
             ${dom.element ? `<div style="color:#b71c1c;font-weight:700">${'&nbsp;'.repeat(dom.ancestorChain.length * 2)}└ &lt;${esc(dom.element.tag)}&gt; ← target</div>` : ''}
           </div>
         </section>` : '';

    const treeBlock = dom.domTree
      ? `<section>
           <h2>🌳 Compressed DOM Tree</h2>
           <pre style="font-size:12px;line-height:1.7">${esc(dom.domTree)}</pre>
         </section>` : '';

    return page('DOM Context', `
${errorNote}
${fingerprintBlock}
${a11yBlock}
<section>
  <h2>🗂 Element State</h2>
  ${dom.state ? `<table class="info-table">
    ${stRow('Visible',  dom.state.visible)}
    ${stRow('Enabled',  dom.state.enabled)}
    ${stRow('Disabled', dom.state.disabled)}
    ${stRow('Editable', dom.state.editable)}
    ${dom.state.checked !== undefined ? stRow('Checked', dom.state.checked) : ''}
  </table>` : '<p class="muted">State not available.</p>'}
</section>
<section>
  <h2>🎨 Interaction Styles</h2>
  ${dom.styles ? `<table class="info-table">
    <tr><td>display</td><td><code>${esc(dom.styles.display)}</code></td></tr>
    <tr><td>visibility</td><td><code>${esc(dom.styles.visibility)}</code></td></tr>
    <tr><td>opacity</td><td><code>${esc(dom.styles.opacity)}</code></td></tr>
    <tr><td>pointer-events</td><td><code>${esc(dom.styles.pointerEvents)}</code></td></tr>
    <tr><td>z-index</td><td><code>${esc(dom.styles.zIndex)}</code></td></tr>
  </table>` : '<p class="muted">Styles not available.</p>'}
</section>
${ancestorBlock}
${treeBlock}`);
  }

  /** Full HTML page: colour-coded network request table. */
  static networkHtml(pkg: FailureIntelligencePackage): string {
    const ev = pkg.evidence;
    const all      = ev.networkRequests;
    const failures = ev.networkFailures;

    const failureSet = new Set(
      failures.map((f) => `${f.method}|${f.url}`)
    );

    const tHead = `<thead>
      <tr>
        <th style="width:70px">Method</th>
        <th style="width:70px">Status</th>
        <th>URL</th>
        <th style="width:90px">Time</th>
      </tr>
    </thead>`;

    const mkRow = (n: NetworkEntry, isFail: boolean) => {
      const method = n.method ?? 'GET';
      const status = n.status;
      const time   = (n.timestamp ?? '').slice(11, 19);
      const url    = n.url ?? '';

      const methodColors: Record<string, string> = {
        GET: 'blue', POST: 'purple', PUT: 'amber',
        PATCH: 'amber', DELETE: 'red', OPTIONS: 'muted',
      };
      const mCls = methodColors[method] ?? 'muted';

      let statusHtml: string;
      if (n.failure || !status) {
        statusHtml = `<span class="badge red">FAILED</span>`;
      } else if (status >= 500) {
        statusHtml = `<span class="badge red">${status}</span>`;
      } else if (status >= 400) {
        statusHtml = `<span class="badge amber">${status}</span>`;
      } else if (status >= 300) {
        statusHtml = `<span class="badge blue">${status}</span>`;
      } else {
        statusHtml = `<span class="badge green">${status}</span>`;
      }

      const failureNote = n.failure
        ? `<br><span style="font-size:11px;color:#b71c1c">${esc(n.failure)}</span>`
        : '';

      return `<tr class="${isFail ? 'row-fail' : ''}">
        <td><span class="badge ${mCls}">${esc(method)}</span></td>
        <td>${statusHtml}</td>
        <td style="word-break:break-all;font-size:12px">${esc(url)}${failureNote}</td>
        <td style="font-size:12px;color:#65676b">${esc(time)}</td>
      </tr>`;
    };

    const failRows = failures.length
      ? failures.map((n) => mkRow(n, true)).join('')
      : `<tr><td colspan="4" class="muted" style="padding:10px">No failing requests.</td></tr>`;

    const allRows = all.length
      ? all.map((n) => mkRow(n, failureSet.has(`${n.method}|${n.url}`))).join('')
      : `<tr><td colspan="4" class="muted" style="padding:10px">No requests captured.</td></tr>`;

    const summary = `<p style="margin:0 0 16px;font-size:14px">
      <strong>${all.length}</strong> total requests &nbsp;·&nbsp;
      <span style="color:#b71c1c;font-weight:600">${failures.length} failed</span> &nbsp;·&nbsp;
      <span style="color:#1a7f37">${all.length - failures.length} successful</span>
    </p>`;

    return page('Network Activity', `
${summary}
<section>
  <h2>⚠️ Failed Requests (${failures.length})</h2>
  <table>${tHead}<tbody>${failRows}</tbody></table>
</section>
<section>
  <h2>🌐 All Requests (${all.length})</h2>
  <table>${tHead}<tbody>${allRows}</tbody></table>
</section>`);
  }

  /** Full HTML page — all intelligence package data in human-readable form. */
  static packageReport(pkg: FailureIntelligencePackage): string {
    const fa  = pkg.failedAction;
    const ai  = pkg.ai;
    const dom = pkg.dom;
    const ev  = pkg.evidence;

    // ── Overview ──────────────────────────────────────────────────────────────
    const overview = `<section>
  <h2>📋 Overview</h2>
  <table class="info-table">
    <tr><td>Scenario</td><td>${esc(pkg.scenarioName)}</td></tr>
    <tr><td>Failed step</td><td>${esc(fa.stepText)}</td></tr>
    <tr><td>Action</td><td><code>${esc(fa.action)}</code></td></tr>
    <tr><td>Locator</td><td><code>${esc(fa.selector ?? '—')}</code></td></tr>
    <tr><td>Timestamp</td><td>${esc(fa.timestamp)}</td></tr>
  </table>
</section>`;

    // ── AI analysis ───────────────────────────────────────────────────────────
    const aiSection = (() => {
      if (!ai.available) {
        return `<section><h2>🤖 AI Analysis</h2><p class="muted">${esc(ai.error ?? 'Not run.')}</p></section>`;
      }
      if (ai.raw) {
        return `<section><h2>🤖 AI Analysis (raw)</h2><pre>${esc(ai.raw)}</pre></section>`;
      }
      const fixes = (items?: string[]) => items?.length
        ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
        : '<p class="muted">—</p>';

      const altCauses = ai.alternativeCauses?.length
        ? `<tr><td>Alternative causes</td><td>
             <ul style="margin:0;padding-left:16px">
               ${ai.alternativeCauses.map((ac) => `<li>${esc(ac.cause)} (${ac.confidence}%)</li>`).join('')}
             </ul>
           </td></tr>`
        : '';

      return `<section>
  <h2>🤖 AI Analysis</h2>
  <table class="info-table">
    <tr><td>Root cause</td><td><strong>${esc(ai.rootCause ?? '—')}</strong></td></tr>
    <tr><td>Explanation</td><td>${esc(ai.explanation ?? '—')}</td></tr>
    ${ai.confidence !== undefined ? `<tr><td>AI Confidence</td><td><strong>${ai.confidence}% (${ai.confidenceLevel || 'High'})</strong></td></tr>` : ''}
    ${altCauses}
    ${ai.issueClassification ? `<tr><td>Classification</td><td>${esc(ai.issueClassification)}</td></tr>` : ''}
    ${ai.rootCauseCategory ? `<tr><td>Category</td><td>${esc(ai.rootCauseCategory)}</td></tr>` : ''}
    ${ai.isFlaky !== undefined ? `<tr><td>Is Flaky</td><td style="color:${ai.isFlaky ? '#b71c1c;font-weight:600' : '#1a7f37'}">${ai.isFlaky ? 'Yes (Timing / Race condition)' : 'No (Deterministic failure)'}</td></tr>` : ''}
    <tr><td>Better locator</td><td>${ai.betterLocator ? `<code>${esc(ai.betterLocator)}</code>` : '—'}</td></tr>
  </table>
  <p style="font-weight:600;margin:12px 0 4px">Application fixes</p>${fixes(ai.appFixes)}
  <p style="font-weight:600;margin:12px 0 4px">Automation improvements</p>${fixes(ai.automationImprovements)}
  <p style="font-weight:600;margin:12px 0 4px">Stability recommendations</p>${fixes(ai.stabilityRecommendations)}
  ${ai.debuggingChecklist?.length ? `<p style="font-weight:600;margin:12px 0 4px">Engineer local debugging checklist</p>${fixes(ai.debuggingChecklist)}` : ''}
</section>`;
    })();

    // ── Timeline reconstruction ───────────────────────────────────────────────
    const timelineSection = (() => {
      if (!ai.available || !ai.timeline || ai.timeline.length === 0) return '';
      const steps = ai.timeline.map((step) => {
        const match = step.match(/^(\d{2}:\d{2})\s+(.*)$/);
        if (match) {
          return `<tr><td style="width:60px;font-family:monospace;font-weight:600;color:#65676b">${esc(match[1])}</td><td>${esc(match[2])}</td></tr>`;
        }
        return `<tr><td style="width:60px;font-family:monospace;font-weight:600;color:#65676b">•</td><td>${esc(step)}</td></tr>`;
      }).join('');
      return `<section>
  <h2>⏳ Failure Timeline Reconstruction</h2>
  <table>
    <thead><tr><th style="width:60px">Time</th><th>Event Description</th></tr></thead>
    <tbody>${steps}</tbody>
  </table>
</section>`;
    })();

    // ── Root causes ───────────────────────────────────────────────────────────
    const rootCauseSection = (() => {
      if (!pkg.rankedRootCauses.length) {
        return `<section><h2>📊 Root Causes</h2><p class="muted">No candidates scored above zero.</p></section>`;
      }
      const items = pkg.rankedRootCauses.map((c, i) => {
        const scoreColor = c.confidence >= 75 ? '#b71c1c' : c.confidence >= 45 ? '#b26a00' : '#65676b';
        const evidence = c.evidence.map((e) =>
          `<li style="color:${e.present ? '#1a7f37' : '#919191'}">${e.present ? '✓' : '✗'} ${esc(e.label)} <span class="muted">(${e.weight})</span></li>`
        ).join('');
        const scoreExpl = ai.scoreExplanations?.[c.title]
          ? `<p style="font-size:12px;color:#65676b;margin:4px 0 0"><em>AI: ${esc(ai.scoreExplanations![c.title])}</em></p>`
          : '';
        return `<div style="border:1px solid #dadde1;border-radius:6px;padding:10px 14px;margin-bottom:10px">
  <div style="display:flex;justify-content:space-between">
    <strong>${i + 1}. ${esc(c.title)}</strong>
    <span style="font-weight:700;color:${scoreColor}">${c.confidence}% <span class="muted" style="font-weight:400;font-size:11px">(raw ${c.rawScore})</span></span>
  </div>
  <ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${evidence}</ul>
  ${scoreExpl}
</div>`;
      }).join('');
      return `<section><h2>📊 Root Causes (${pkg.rankedRootCauses.length})</h2>${items}</section>`;
    })();


    // ── DOM intelligence ──────────────────────────────────────────────────────
    const domSection = (() => {
      const stateRows = dom.state
        ? [
            infoRow('Visible',  String(dom.state.visible)),
            infoRow('Enabled',  String(dom.state.enabled)),
            infoRow('Disabled', String(dom.state.disabled)),
            infoRow('Editable', String(dom.state.editable)),
            dom.state.checked !== undefined ? infoRow('Checked', String(dom.state.checked)) : '',
          ].join('')
        : '';
      const styleRows = dom.styles
        ? [
            infoRow('display',        dom.styles.display),
            infoRow('visibility',     dom.styles.visibility),
            infoRow('opacity',        dom.styles.opacity),
            infoRow('pointer-events', dom.styles.pointerEvents),
            infoRow('z-index',        dom.styles.zIndex),
          ].join('')
        : '';
      const attrRows = (() => {
        const el = dom.element;
        if (!el) return '';
        const rows: string[] = [];
        if (el.role)  rows.push(infoRow('role', el.role));
        if (el.name)  rows.push(infoRow('name', el.name));
        if (el.type)  rows.push(infoRow('type', el.type));
        for (const [k, v] of Object.entries(el.ariaAttributes ?? {})) rows.push(infoRow(k, v));
        for (const [k, v] of Object.entries(el.dataAttributes ?? {})) rows.push(infoRow(k, v));
        return rows.length ? `<h3 style="font-size:13px;margin:12px 0 4px">Attributes</h3>
<table class="info-table">${rows.join('')}</table>` : '';
      })();
      const overlayNote = dom.blockingOverlay
        ? `<p class="error-note">⚠️ Blocking overlay: &lt;${esc(dom.blockingOverlay.tag)}&gt; z-index ${esc(dom.blockingOverlay.zIndex)}</p>`
        : '';
      const treeBlock = dom.domTree
        ? `<h3 style="font-size:13px;margin:12px 0 4px">Compressed DOM Tree</h3><pre style="font-size:12px;line-height:1.7">${esc(dom.domTree)}</pre>`
        : '';
      const errorNote = dom.error
        ? `<p class="muted" style="font-size:12px">⚠️ ${esc(dom.error)}</p>` : '';

      return `<section>
  <h2>🧬 DOM Intelligence</h2>
  ${errorNote}
  ${overlayNote}
  <div style="display:flex;gap:32px;flex-wrap:wrap">
    ${stateRows ? `<div><h3 style="font-size:13px;margin:0 0 4px">State</h3><table class="info-table">${stateRows}</table></div>` : ''}
    ${styleRows ? `<div><h3 style="font-size:13px;margin:0 0 4px">Styles</h3><table class="info-table">${styleRows}</table></div>` : ''}
  </div>
  ${attrRows}
  ${treeBlock}
</section>`;
    })();

    // ── Evidence ──────────────────────────────────────────────────────────────
    const evidenceSection = (() => {
      const b = ev.browser;
      const e = ev.environment;
      const consoleRows = ev.consoleLogs.length
        ? ev.consoleLogs.map((c) =>
            `<tr><td style="white-space:nowrap;color:#65676b">${esc((c.timestamp ?? '').slice(11, 19))}</td>
                 <td><span class="badge ${c.type === 'error' || c.type === 'pageerror' ? 'red' : 'amber'}">${esc(c.type)}</span></td>
                 <td style="word-break:break-all;font-size:12px">${esc(c.text)}</td></tr>`
          ).join('')
        : `<tr><td colspan="3" class="muted">No console logs.</td></tr>`;

      const netFailRows = ev.networkFailures.length
        ? ev.networkFailures.map((n) =>
            `<tr class="row-fail">
               <td><span class="badge ${methodBadgeClass(n.method ?? '')}">${esc(n.method ?? '')}</span></td>
               <td>${n.status ? `<span class="badge red">${n.status}</span>` : '<span class="badge red">FAILED</span>'}</td>
               <td style="word-break:break-all;font-size:12px">${esc(n.url ?? '')}${n.failure ? `<br><span style="color:#b71c1c;font-size:11px">${esc(n.failure)}</span>` : ''}</td>
               <td style="font-size:12px;color:#65676b">${esc((n.timestamp ?? '').slice(11, 19))}</td>
             </tr>`
          ).join('')
        : `<tr><td colspan="4" class="muted">No failing requests.</td></tr>`;

      const callLog = ev.playwrightCallLog?.length
        ? `<h3 style="font-size:13px;margin:12px 0 4px">Playwright Call Log</h3>
           <pre style="font-size:12px">${esc(ev.playwrightCallLog.join('\n'))}</pre>`
        : '';

      return `<section>
  <h2>🧾 Evidence</h2>
  <table class="info-table" style="margin-bottom:12px">
    <tr><td>Browser</td><td>${esc(b.name)} · ${b.headless ? 'headless' : 'headed'}${b.viewport ? ` · ${b.viewport.width}×${b.viewport.height}` : ''}</td></tr>
    <tr><td>URL</td><td style="word-break:break-all">${esc(b.url ?? '—')}</td></tr>
    <tr><td>Environment</td><td>${esc(e.testEnv)}${e.ci ? ' · CI' : ''}</td></tr>
    <tr><td>Platform</td><td>${esc(e.platform)} · Node ${esc(e.nodeVersion)}</td></tr>
    ${e.baseUrl ? `<tr><td>Base URL</td><td>${esc(e.baseUrl)}</td></tr>` : ''}
  </table>
  <h3 style="font-size:13px;margin:12px 0 4px">Console Logs (${ev.consoleLogs.length})</h3>
  <table>
    <thead><tr><th>Time</th><th>Type</th><th>Message</th></tr></thead>
    <tbody>${consoleRows}</tbody>
  </table>
  <h3 style="font-size:13px;margin:16px 0 4px">Network Failures (${ev.networkFailures.length}) / Total Requests (${ev.networkRequests.length})</h3>
  <table>
    <thead><tr><th>Method</th><th>Status</th><th>URL</th><th>Time</th></tr></thead>
    <tbody>${netFailRows}</tbody>
  </table>
  ${callLog}
</section>`;
    })();

    // ── Stack trace ───────────────────────────────────────────────────────────
    const stackSection = `<section>
  <h2>🧵 Stack Trace</h2>
  <pre style="font-size:12px">${esc(pkg.errorMessage)}</pre>
</section>`;

    const selectorDiffSec = ReportRenderer.selectorDiffSection(pkg);
    const patchSec = ReportRenderer.patchSection(pkg);

    return page('Failure Intelligence Package', `
${overview}
${selectorDiffSec}
${patchSec}
${aiSection}
${timelineSection}
${rootCauseSection}
${domSection}
${evidenceSection}
${stackSection}
<p style="font-size:11px;color:#90949c;margin-top:24px">
  Confidence values are evidence-strength scores produced by a deterministic rule engine — not statistical probabilities.
</p>`);
  }

  /** Plain-text console log dump. */
  static consoleTxt(pkg: FailureIntelligencePackage): string {
    const logs = pkg.evidence.consoleLogs;
    if (!logs.length) return 'No console logs captured.';
    const lines = logs.map((c) => `[${c.timestamp ?? ''}] [${c.type.toUpperCase()}] ${c.text}`);
    return `=== Console Logs (${logs.length}) ===\nScenario: ${pkg.scenarioName}\n\n${lines.join('\n')}`;
  }



  /** JSON environment + browser metadata. */
  static envJson(pkg: FailureIntelligencePackage): string {
    return JSON.stringify({
      scenario: pkg.scenarioName,
      failedStep: pkg.failedAction.stepText,
      timestamp: pkg.failedAction.timestamp,
      browser: pkg.evidence.browser,
      environment: pkg.evidence.environment,
    }, null, 2);
  }

  // ── 1. Environment bar ───────────────────────────────────────────────────────

  private static envBar(pkg: FailureIntelligencePackage): string {
    const b = pkg.evidence.browser;
    const e = pkg.evidence.environment;

    const chip = (icon: string, text: string, color = '#3a3b3c') =>
      `<span style="display:inline-flex;align-items:center;gap:4px;background:#f0f2f5;border-radius:20px;padding:3px 10px;font-size:12px;color:${color}">${icon} ${esc(text)}</span>`;

    const chips: string[] = [];
    chips.push(chip('🌐', `${b.name} · ${b.headless ? 'headless' : 'headed'}`));
    if (b.viewport) chips.push(chip('📐', `${b.viewport.width}×${b.viewport.height}`));
    if (b.url) {
      const u = b.url.length > 70 ? b.url.slice(0, 70) + '…' : b.url;
      chips.push(chip('🔗', u));
    }
    chips.push(chip('🏷', e.testEnv));
    if (e.ci) chips.push(chip('⚙️', 'CI', '#1a7f37'));
    chips.push(chip('💻', `${e.platform} · Node ${e.nodeVersion}`));
    chips.push(chip('⏰', pkg.failedAction.timestamp));

    return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">${chips.join('')}</div>`;
  }

  // ── 2. Failure summary ───────────────────────────────────────────────────────

  private static summary(pkg: FailureIntelligencePackage): string {
    const fa = pkg.failedAction;
    return `
<h2 style="margin:0 0 4px">🔍 Failure Summary</h2>
<div style="background:#fff5f5;border:1px solid #f5c2c0;border-radius:8px;padding:12px 16px;margin:8px 0 20px">
  <div style="font-size:16px;font-weight:600;color:#b71c1c">${esc(fa.description || fa.stepText)}</div>
  <table style="margin-top:8px;font-size:13px;border-collapse:collapse">
    ${row('Scenario', pkg.scenarioName)}
    ${row('Failed step', fa.stepText)}
    ${row('Action', fa.action)}
    ${row('Locator', fa.selector ?? '—')}
    ${row('Timestamp', fa.timestamp)}
  </table>
</div>`;
  }

  // ── 3. AI recommendation ─────────────────────────────────────────────────────

  private static aiRecommendation(pkg: FailureIntelligencePackage): string {
    const ai = pkg.ai;
    if (!ai.available) {
      return `
<div style="background:#f0f2f5;border-radius:8px;padding:12px 16px;margin:0 0 20px;font-size:13px;color:#65676b">
  🤖 <strong>AI analysis unavailable.</strong> ${esc(ai.error ?? 'Not run.')}
</div>`;
    }
    const classificationBar = (ai.issueClassification || ai.rootCauseCategory || ai.isFlaky !== undefined)
      ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;font-size:12px">
           ${ai.issueClassification ? `<span style="background:#dadde1;color:#1c1e21;padding:2px 8px;border-radius:12px;font-weight:600">Classification: ${esc(ai.issueClassification)}</span>` : ''}
           ${ai.rootCauseCategory ? `<span style="background:#dadde1;color:#1c1e21;padding:2px 8px;border-radius:12px;font-weight:600">Category: ${esc(ai.rootCauseCategory)}</span>` : ''}
           ${ai.isFlaky !== undefined ? `<span style="background:${ai.isFlaky ? '#fff0f0;color:#c00;border:1px solid #fcc' : '#f0fff0;color:#070;border:1px solid #cfc'};padding:2px 8px;border-radius:12px;font-weight:600">${ai.isFlaky ? '⚠️ Timing / Flaky' : '✓ Deterministic'}</span>` : ''}
         </div>`
      : '';
    const scoreColor = ai.confidence && ai.confidence >= 75 ? '#b71c1c' : ai.confidence && ai.confidence >= 45 ? '#b26a00' : '#65676b';
    const barFill = ai.confidence ? Math.max(0, Math.min(100, ai.confidence)) : 0;
    const confidenceBlock = ai.confidence !== undefined
      ? `<div style="margin-top:14px;border-top:1px solid #aac4f5;padding-top:12px">
           <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
             <span style="font-size:12px;font-weight:600;color:#3a3b3c">AI Confidence: <strong>${ai.confidence}% (${ai.confidenceLevel || 'High'})</strong></span>
           </div>
           <div style="background:#ebedf0;border-radius:4px;height:6px;overflow:hidden;margin-bottom:8px">
             <div style="width:${barFill}%;height:6px;background:${scoreColor};border-radius:4px"></div>
           </div>
         </div>`
      : '';
    const alternativesBlock = ai.alternativeCauses?.length
      ? `<div style="margin-top:10px;font-size:12px">
           <span style="font-weight:600;color:#3a3b3c">Alternative causes considered:</span>
           <ul style="margin:4px 0 0;padding-left:18px;color:#555">
             ${ai.alternativeCauses.map((ac) => `<li>${esc(ac.cause)} <span class="muted">(${ac.confidence}%)</span></li>`).join('')}
           </ul>
         </div>`
      : '';
    const text = ai.rootCause
      ? `<strong>${esc(ai.rootCause)}</strong><br>${esc(ai.explanation ?? '')}${classificationBar}${confidenceBlock}${alternativesBlock}`
      : esc(ai.raw ?? '');
    return `
<h2 style="margin:0 0 4px">🤖 AI Recommendation</h2>
<div style="background:#e8f0fe;border:1px solid #aac4f5;border-radius:8px;padding:12px 16px;margin:8px 0 20px;font-size:14px">
  ${text}
</div>`;
  }

  // ── 4. Ranked root causes ────────────────────────────────────────────────────

  private static rootCauses(causes: RootCauseCandidate[], pkg: FailureIntelligencePackage): string {
    if (!causes.length) {
      return `<p style="color:#65676b">No deterministic root-cause candidates scored above zero.</p>`;
    }
    const items = causes
      .map((c, i) => {
        const reason = pkg.ai.scoreExplanations?.[c.title];
        const bullets = c.evidence
          .map(
            (e) =>
              `<li style="color:${e.present ? '#1a7f37' : '#919191'}">${e.present ? '✓' : '✗'} ${esc(e.label)}</li>`
          )
          .join('');
        return `
<div style="border:1px solid #dadde1;border-radius:8px;padding:12px 16px;margin-bottom:12px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div style="font-weight:600">${i + 1}. ${esc(c.title)}</div>
    <div style="font-weight:700;color:${confColor(c.confidence)}">${c.confidence}%</div>
  </div>
  ${bar(c.confidence)}
  <ul style="margin:8px 0 0;padding-left:18px;font-size:13px">${bullets}</ul>
  ${reason ? `<div style="margin-top:6px;font-size:12px;color:#65676b"><em>AI: ${esc(reason)}</em></div>` : ''}
</div>`;
      })
      .join('');
    return `<h2 style="margin:24px 0 8px">📊 Ranked Root Causes</h2>${items}`;
  }

  private static timelineSection(pkg: FailureIntelligencePackage): string {
    const ai = pkg.ai;
    if (!ai.available || !ai.timeline || ai.timeline.length === 0) return '';
    
    const steps = ai.timeline.map((step) => {
      const match = step.match(/^(\d{2}:\d{2})\s+(.*)$/);
      if (match) {
        return `<div style="display:flex;margin-bottom:6px;font-size:13px">
                  <span style="font-family:monospace;font-weight:600;color:#65676b;width:50px;flex-shrink:0">${esc(match[1])}</span>
                  <span style="color:#1c1e21">${esc(match[2])}</span>
                </div>`;
      }
      return `<div style="margin-bottom:6px;font-size:13px;color:#1c1e21">• ${esc(step)}</div>`;
    }).join('');

    return `
<h2 style="margin:24px 0 8px">⏳ Failure Timeline Reconstruction</h2>
<div style="border:1px solid #dadde1;border-radius:8px;padding:14px 16px;background:#fcfcfc">
  ${steps}
</div>`;
  }

  // ── Selector diff — DOM-derived fix, shown regardless of AI availability ────

  /**
   * Renders the pre-computed selector diff produced by FailureIntelligenceEngine
   * BEFORE the Gemini call. Shown even when AI is disabled or timed out, because
   * it is derived entirely from the live DOM via SimilarityEngine — no LLM needed.
   */
  private static selectorDiffSection(pkg: FailureIntelligencePackage): string {
    const diff = pkg.selectorDiff;
    if (!diff) return '';

    // Headline locator — the AI's pick when available, else the top verified one.
    const aiPicked = !!(pkg.ai.available && pkg.ai.betterLocator && pkg.ai.betterLocator === diff.preComputedLocator);
    const headlineLabel = aiPicked ? '✓ AI-selected best locator' : '✓ DOM-derived suggested locator';
    const reasonLine = aiPicked && pkg.ai.betterLocatorReason
      ? `<div style="font-size:12px;color:#3a3b3c;margin-top:4px;font-style:italic">${esc(pkg.ai.betterLocatorReason)}</div>`
      : '';
    const locatorBlock = diff.preComputedLocator
      ? `<div style="margin-bottom:12px">
           <span style="font-size:12px;font-weight:600;color:#1a7f37">${headlineLabel}</span><br>
           <code style="display:inline-block;margin-top:4px;background:#e6ffed;border:1px solid #a7f3d0;padding:4px 10px;border-radius:6px;font-size:13px">${esc(diff.preComputedLocator)}</code>
           ${reasonLine}
         </div>`
      : `<p style="font-size:12px;color:#65676b;margin:0 0 10px">No high-confidence DOM match found — SimilarityEngine score below threshold.</p>`;

    // Live-DOM validation badge: did the suggested locator actually resolve?
    const v = diff.locatorValidation;
    const validationBlock = (() => {
      if (!v) return '';
      const badge = (bg: string, border: string, fg: string, icon: string, text: string) =>
        `<div style="margin-bottom:12px"><span style="display:inline-block;background:${bg};border:1px solid ${border};color:${fg};padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600">${icon} ${text}</span></div>`;
      switch (v.status) {
        case 'verified':
          return badge('#e6ffed', '#a7f3d0', '#1a7f37', '✓', `Verified against live DOM — resolves to exactly 1 element`);
        case 'ambiguous':
          return badge('#fff8e1', '#ffe08a', '#8a6d00', '⚠', `Ambiguous — resolves to ${v.matchCount} elements on the live page; add a more specific filter`);
        case 'unresolved':
          return badge('#fdecea', '#f5c6cb', '#b71c1c', '✗', `Did not resolve on the live page (0 matches) — treat as a guess`);
        default:
          return badge('#f0f2f5', '#d0d7de', '#65676b', 'ℹ', `Could not be validated${v.error ? `: ${esc(v.error)}` : ''}`);
      }
    })();

    // Difference hints (e.g. "id has 1-char typo: 'NewAcount' → 'NewAccount'").
    const hintsBlock = diff.differenceHints.length
      ? `<div style="margin-bottom:10px">
           <span style="font-size:12px;font-weight:600;color:#3a3b3c">Difference hints</span>
           <ul style="margin:4px 0 0;padding-left:18px;font-size:13px">
             ${diff.differenceHints.map((h) => `<li>${esc(h)}</li>`).join('')}
           </ul>
         </div>`
      : '';

    // Side-by-side: what the test expected vs what the DOM has.
    const expectedKeys = Object.keys(diff.parsedTarget);
    const expectedBlock = expectedKeys.length
      ? `<div style="flex:1;min-width:200px">
           <div style="font-size:12px;font-weight:600;color:#b71c1c;margin-bottom:4px">What the selector expected</div>
           <table style="font-size:12px;border-collapse:collapse">
             ${expectedKeys.map((k) => `<tr><td style="padding:2px 10px 2px 0;color:#65676b">${esc(k)}</td><td style="font-family:monospace">${esc(diff.parsedTarget[k])}</td></tr>`).join('')}
           </table>
         </div>`
      : '';

    const actualKeys = diff.topCandidateAttributes ? Object.keys(diff.topCandidateAttributes) : [];
    const actualBlock = actualKeys.length
      ? `<div style="flex:1;min-width:200px">
           <div style="font-size:12px;font-weight:600;color:#1a7f37;margin-bottom:4px">What the DOM actually has</div>
           <table style="font-size:12px;border-collapse:collapse">
             ${actualKeys.map((k) => `<tr><td style="padding:2px 10px 2px 0;color:#65676b">${esc(k)}</td><td style="font-family:monospace">${esc(diff.topCandidateAttributes![k])}</td></tr>`).join('')}
           </table>
         </div>`
      : '';

    const compareBlock = (expectedBlock || actualBlock)
      ? `<div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:8px">${expectedBlock}${actualBlock}</div>`
      : '';

    // All ranked candidates, each validated against the live DOM. The chosen one
    // is starred; the rest are shown so a human can override the pick.
    const candidatesBlock = (() => {
      const cands = diff.candidates;
      if (!cands || cands.length === 0) return '';
      const notes = new Map<string, string>(
        (pkg.ai.candidateAssessments ?? []).map((a) => [a.locator, a.note])
      );
      const statusBadge = (s: string, n: number) => {
        switch (s) {
          case 'verified':   return `<span style="color:#1a7f37">✓ 1 match</span>`;
          case 'ambiguous':  return `<span style="color:#8a6d00">⚠ ${n} matches</span>`;
          case 'unresolved': return `<span style="color:#b71c1c">✗ 0 matches</span>`;
          default:           return `<span style="color:#65676b">ℹ n/a</span>`;
        }
      };
      const rows = cands.map((c) => {
        const chosen = c.locator === diff.preComputedLocator;
        const note = notes.get(c.locator);
        return `<tr style="${chosen ? 'background:#e6ffed' : ''}">
          <td style="padding:4px 8px;vertical-align:top;white-space:nowrap">${chosen ? '★' : ''}</td>
          <td style="padding:4px 8px;vertical-align:top"><code style="font-size:12px">${esc(c.locator)}</code>${note ? `<div style="font-size:11px;color:#65676b;margin-top:2px">${esc(note)}</div>` : ''}</td>
          <td style="padding:4px 8px;vertical-align:top;text-align:right;color:#65676b">${c.score}%</td>
          <td style="padding:4px 8px;vertical-align:top;white-space:nowrap;font-size:12px">${statusBadge(c.status, c.matchCount)}</td>
        </tr>`;
      }).join('');
      return `<div style="margin-top:12px">
        <span style="font-size:12px;font-weight:600;color:#3a3b3c">Candidates considered (ranked, live-DOM validated)</span>
        <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
          <thead><tr style="color:#90949c;font-size:11px;text-align:left">
            <th style="padding:0 8px"></th><th style="padding:0 8px">Locator</th>
            <th style="padding:0 8px;text-align:right">Score</th><th style="padding:0 8px">Live DOM</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="font-size:11px;color:#90949c;margin-top:4px">★ = selected. Others shown so you can override the pick.</div>
      </div>`;
    })();

    return `
<h2 style="margin:0 0 4px">🔧 Suggested Fix</h2>
<div style="background:#f0fff4;border:1px solid #a7f3d0;border-radius:8px;padding:12px 16px;margin:8px 0 20px;font-size:13px">
  <div style="font-size:12px;color:#65676b;margin-bottom:8px">
    Source: <strong>SimilarityEngine (live DOM scan)</strong> — available regardless of AI status.
    Failing selector: <code style="background:#fff;padding:1px 5px;border-radius:3px">${esc(diff.failingSelector)}</code>
  </div>
  ${locatorBlock}
  ${validationBlock}
  ${hintsBlock}
  ${compareBlock}
  ${candidatesBlock}
</div>`;
  }

  /**
   * Ready-to-apply source patch — a copy-paste diff that swaps the failing
   * locator for the verified fix in its page object. Shown only when AutoPatch
   * located the selector and produced a rewrite; never auto-applied.
   */
  private static patchSection(pkg: FailureIntelligencePackage): string {
    const p = pkg.patchSuggestion;
    if (!p) return '';

    const diffHtml = p.diff
      .split('\n')
      .map((ln) => {
        const color = ln.startsWith('+') && !ln.startsWith('+++') ? '#1a7f37'
          : ln.startsWith('-') && !ln.startsWith('---') ? '#b71c1c'
          : ln.startsWith('@@') ? '#8250df'
          : '#65676b';
        const bg = ln.startsWith('+') && !ln.startsWith('+++') ? '#e6ffed'
          : ln.startsWith('-') && !ln.startsWith('---') ? '#ffeef0'
          : 'transparent';
        return `<div style="background:${bg};color:${color};padding:0 8px;white-space:pre">${esc(ln)}</div>`;
      })
      .join('');

    return `
<h2 style="margin:0 0 4px">🩹 Suggested Code Patch</h2>
<div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:12px 16px;margin:8px 0 20px;font-size:13px">
  <div style="font-size:12px;color:#65676b;margin-bottom:8px">
    Apply to <code style="background:#fff;padding:1px 5px;border-radius:3px">${esc(p.file)}</code>
    at line <strong>${p.line}</strong>. Review before committing — this is a suggestion, not an automatic edit.
  </div>
  <div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;border:1px solid #d0d7de;border-radius:6px;overflow-x:auto">
    ${diffHtml}
  </div>
</div>`;
  }

  // ── 5. AI suggested fixes ────────────────────────────────────────────────────

  private static aiSuggestions(pkg: FailureIntelligencePackage): string {
    const ai = pkg.ai;
    if (!ai.available) return '';
    const blocks: string[] = [];
    if (ai.betterLocator) {
      blocks.push(
        `<div style="margin-bottom:10px"><strong>Suggested locator:</strong> <code style="background:#f0f2f5;padding:2px 6px;border-radius:4px">${esc(ai.betterLocator)}</code></div>`
      );
    }
    blocks.push(list('Suggested application fixes', ai.appFixes));
    blocks.push(list('Suggested automation improvements', ai.automationImprovements));
    blocks.push(list('Test stability recommendations', ai.stabilityRecommendations));
    blocks.push(list('Engineer local debugging checklist', ai.debuggingChecklist));
    const body = blocks.filter(Boolean).join('');
    if (!body) return '';
    return `<h2 style="margin:24px 0 8px">🛠️ AI Suggested Fixes</h2><div style="font-size:13px">${body}</div>`;
  }



  // ── 7. DOM intelligence ──────────────────────────────────────────────────────

  private static domSection(pkg: FailureIntelligencePackage): string {
    const dom = pkg.dom;
    if (dom.error && !dom.element) {
      return `<h2 style="margin:24px 0 8px">🧬 DOM Intelligence</h2><p style="color:#65676b;font-size:13px">${esc(dom.error)}</p>`;
    }

    const st = dom.state;
    const sy = dom.styles;

    const stateTable = st
      ? `<table style="font-size:13px;border-collapse:collapse">
           ${stateRow('Visible',  st.visible)}
           ${stateRow('Enabled',  st.enabled)}
           ${stateRow('Disabled', st.disabled)}
           ${stateRow('Editable', st.editable)}
           ${st.checked !== undefined ? stateRow('Checked', st.checked) : ''}
         </table>`
      : '';

    const styleTable = sy
      ? `<table style="font-size:13px;border-collapse:collapse">
           ${row('display',        sy.display)}
           ${row('visibility',     sy.visibility)}
           ${row('opacity',        sy.opacity)}
           ${row('pointer-events', sy.pointerEvents)}
           ${row('z-index',        sy.zIndex)}
         </table>`
      : '';

    const overlay = dom.blockingOverlay
      ? `<div style="color:#b71c1c;font-size:13px;margin-top:8px;padding:8px 12px;background:#fff5f5;border-radius:6px;border:1px solid #f5c2c0">
           ⚠️ Blocking overlay: <strong>&lt;${esc(dom.blockingOverlay.tag)}&gt;</strong>
           ${dom.blockingOverlay.classes?.length ? `class="${esc(dom.blockingOverlay.classes.join(' '))}"` : ''}
           z-index <strong>${esc(dom.blockingOverlay.zIndex)}</strong>
         </div>`
      : '';

    const attrsHtml      = ReportRenderer.elementAttrs(dom.element);
    const fingerprintHtml = ReportRenderer.fingerprintPanel(dom.fingerprint, dom.boundingBox);
    const a11yHtml        = ReportRenderer.a11yPanel(dom.a11y);
    const ancestorHtml    = ReportRenderer.ancestorChainPanel(dom.ancestorChain, dom.element?.tag);
    const localWindowHtml = ReportRenderer.localWindowPanel(dom.localWindow);
    const treeHtml        = ReportRenderer.domTreePanel(dom.domTree);
    const semanticHtml    = ReportRenderer.semanticSummaryPanel(dom.semanticSummary);

    return `
<h2 style="margin:24px 0 8px">🧬 DOM Intelligence</h2>
<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:8px">
  <div><div style="font-weight:600;font-size:13px;margin-bottom:4px">Element state</div>${stateTable}</div>
  <div><div style="font-weight:600;font-size:13px;margin-bottom:4px">Interaction styles</div>${styleTable}</div>
</div>
${overlay}
${fingerprintHtml}
${a11yHtml}
${attrsHtml}
${ancestorHtml}
${localWindowHtml}
${treeHtml}
${semanticHtml}
<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:#1877f2">Raw element JSON</summary>
<pre style="background:#f6f8fa;border-radius:6px;padding:10px;overflow:auto;font-size:12px">${esc(JSON.stringify(dom.element ?? {}, null, 2))}</pre></details>`;
  }

  private static elementAttrs(el: ElementInfo | undefined): string {
    if (!el) return '';
    const rows: string[] = [];

    // Core attributes
    if (el.role)  rows.push(attrRow('role', el.role));
    if (el.name)  rows.push(attrRow('name', el.name));
    if (el.type)  rows.push(attrRow('type', el.type));

    // Aria attributes
    const aria = el.ariaAttributes ?? {};
    for (const [k, v] of Object.entries(aria)) {
      const bad = v === 'true' && (k === 'aria-disabled' || k === 'aria-hidden');
      rows.push(attrRow(k, v, bad ? '#b71c1c' : undefined));
    }

    // Data attributes
    const data = el.dataAttributes ?? {};
    for (const [k, v] of Object.entries(data)) {
      rows.push(attrRow(k, v));
    }

    if (!rows.length) return '';
    return `
<details style="margin-top:8px" open>
  <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#1c1e21">Element Attributes (${rows.length})</summary>
  <table style="margin-top:6px;font-size:12px;border-collapse:collapse;width:100%">
    <thead>
      <tr style="background:#f0f2f5">
        <th style="text-align:left;padding:4px 12px 4px 8px;color:#65676b;font-weight:600">Attribute</th>
        <th style="text-align:left;padding:4px 8px;color:#65676b;font-weight:600">Value</th>
      </tr>
    </thead>
    <tbody>${rows.join('')}</tbody>
  </table>
</details>`;
  }

  // ── New structured DOM panel renderers ──────────────────────────────────────

  private static fingerprintPanel(fp: ElementFingerprint | undefined, bb: { x: number; y: number; width: number; height: number } | undefined): string {
    if (!fp) return '';
    return `
<div style="margin-top:10px">
  <div style="font-weight:600;font-size:13px;margin-bottom:4px">🪪 Element Fingerprint</div>
  <table style="font-size:12px;border-collapse:collapse">
    <tr><td style="padding:2px 12px 2px 0;color:#65676b">tag</td><td style="font-family:monospace">&lt;${esc(fp.tag)}&gt;</td></tr>
    ${fp.role  ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b">role</td><td style="font-family:monospace">${esc(fp.role)}</td></tr>` : ''}
    ${fp.text  ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b">text</td><td>"${esc(fp.text)}"</td></tr>` : ''}
    <tr><td style="padding:2px 12px 2px 0;color:#65676b;vertical-align:top">CSS path</td><td style="font-family:monospace;font-size:11px;word-break:break-all">${esc(fp.path)}</td></tr>
    ${bb ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b">bounding box</td><td style="font-family:monospace">${bb.width}×${bb.height} at (${bb.x}, ${bb.y})</td></tr>` : ''}
    ${fp.nearbyText.length ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b;vertical-align:top">nearby text</td><td>${fp.nearbyText.map((t) => `<span style="background:#f0f2f5;border-radius:4px;padding:1px 5px;margin-right:4px;font-size:11px">${esc(t)}</span>`).join('')}</td></tr>` : ''}
  </table>
</div>`;
  }

  private static a11yPanel(a11y: A11ySnapshot | undefined): string {
    if (!a11y) return '';
    return `
<details style="margin-top:8px" open>
  <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#1c1e21">♿ Accessibility Snapshot</summary>
  <table style="margin-top:6px;font-size:12px;border-collapse:collapse">
    ${a11y.role    ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b">role</td><td style="font-family:monospace">${esc(a11y.role)}</td></tr>` : ''}
    ${a11y.name    ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b">accessible name</td><td>${esc(a11y.name)}</td></tr>` : ''}
    ${a11y.label   ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b">aria-label</td><td>${esc(a11y.label)}</td></tr>` : ''}
    <tr><td style="padding:2px 12px 2px 0;color:#65676b">disabled</td><td style="font-weight:600;color:${a11y.disabled ? '#b71c1c' : '#1a7f37'}">${a11y.disabled}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#65676b">focused</td><td style="font-family:monospace">${a11y.focused}</td></tr>
    ${a11y.required !== undefined ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b">required</td><td style="font-family:monospace">${a11y.required}</td></tr>` : ''}
    ${a11y.expanded !== undefined ? `<tr><td style="padding:2px 12px 2px 0;color:#65676b">aria-expanded</td><td style="font-family:monospace">${a11y.expanded}</td></tr>` : ''}
  </table>
</details>`;
  }

  private static ancestorChainPanel(chain: string[] | undefined, targetTag?: string): string {
    if (!chain || !chain.length) return '';
    const lines = chain.map((seg, i) =>
      `<div style="font-family:monospace;font-size:12px">${'&nbsp;'.repeat(i * 2)}└ ${esc(seg)}</div>`
    );
    if (targetTag) {
      lines.push(`<div style="font-family:monospace;font-size:12px;font-weight:700;color:#b71c1c">${'&nbsp;'.repeat(chain.length * 2)}└ &lt;${esc(targetTag)}&gt; ← target</div>`);
    }
    return `
<div style="margin-top:10px">
  <div style="font-weight:600;font-size:13px;margin-bottom:4px">Ancestor Chain</div>
  ${lines.join('')}
</div>`;
  }

  private static localWindowPanel(lw: LocalDomWindow | undefined): string {
    if (!lw || (!lw.siblings.length && !lw.children.length)) return '';
    const elRow = (s: ElementInfo) => {
      const id  = s.id ? `<span style="color:#6f42c1">#${esc(s.id)}</span>` : '';
      const cls = s.classes?.length ? `<span style="color:#0969da">.${esc(s.classes.slice(0, 2).join('.'))}</span>` : '';
      const txt = s.text ? `<span style="color:#65676b;font-style:italic"> "${esc(s.text.slice(0, 40))}"</span>` : '';
      return `<div style="font-family:monospace;font-size:12px;padding:1px 0">&lt;${esc(s.tag)}&gt;${id}${cls}${txt}</div>`;
    };
    return `
<details style="margin-top:8px">
  <summary style="cursor:pointer;font-size:13px;color:#1877f2">Local DOM Window (siblings: ${lw.siblings.length}, children: ${lw.children.length})</summary>
  <div style="margin-top:6px;display:flex;gap:24px;flex-wrap:wrap">
    ${lw.siblings.length ? `<div><div style="font-size:12px;font-weight:600;color:#65676b;margin-bottom:4px">Siblings</div>${lw.siblings.map(elRow).join('')}</div>` : ''}
    ${lw.children.length ? `<div><div style="font-size:12px;font-weight:600;color:#65676b;margin-bottom:4px">Children</div>${lw.children.map(elRow).join('')}</div>` : ''}
  </div>
</details>`;
  }

  private static domTreePanel(tree: string | undefined): string {
    if (!tree) return '';
    return `
<details style="margin-top:8px" open>
  <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#1c1e21">🌳 Compressed DOM Tree</summary>
  <pre style="background:#f6f8fa;border:1px solid #dadde1;border-radius:6px;padding:10px;overflow:auto;font-size:12px;line-height:1.7;margin-top:6px">${esc(tree)}</pre>
</details>`;
  }

  private static semanticSummaryPanel(sm: SemanticSummary | undefined): string {
    if (!sm) return '';
    const chip = (label: string) => `<span style="background:#f0f2f5;border-radius:4px;padding:2px 7px;font-size:12px;margin:2px 4px 2px 0;display:inline-block">${esc(label)}</span>`;
    const section = (title: string, items: string[]) => items.length
      ? `<div style="margin-bottom:8px"><span style="font-size:12px;font-weight:600;color:#65676b">${title}:</span> ${items.map(chip).join('')}</div>`
      : '';
    return `
<details style="margin-top:8px">
  <summary style="cursor:pointer;font-size:13px;color:#1877f2">Semantic Page Summary${sm.pageTitle ? ` — ${esc(sm.pageTitle)}` : ''}</summary>
  <div style="margin-top:8px">
    ${section('Buttons',  sm.buttons)}
    ${section('Inputs',   sm.inputs)}
    ${section('Forms',    sm.forms)}
    ${section('Dialogs',  sm.dialogs)}
    ${section('Headings', sm.headings)}
  </div>
</details>`;
  }

  // ── 8. Console logs ──────────────────────────────────────────────────────────

  private static logsSection(pkg: FailureIntelligencePackage): string {
    const logs = pkg.evidence.consoleLogs;

    const errors   = logs.filter((c) => c.type === 'pageerror' || c.type === 'error');
    const warnings = logs.filter((c) => c.type === 'warning');
    const others   = logs.filter((c) => c.type !== 'pageerror' && c.type !== 'error' && c.type !== 'warning');

    if (!logs.length) {
      return `
<h2 style="margin:24px 0 8px">📜 Console Logs</h2>
<p style="font-size:13px;color:#65676b;margin:0">No console errors or warnings captured.</p>`;
    }

    const badge = (count: number, color: string, label: string) =>
      count > 0
        ? `<span style="background:${color};color:#fff;border-radius:20px;padding:1px 8px;font-size:11px;font-weight:600">${count} ${label}</span> `
        : '';

    const consoleRows = (entries: typeof logs, color: string) =>
      entries.map((c) =>
        `<li style="margin-bottom:4px;color:${color};word-break:break-word">[${esc(c.type)}] ${esc(c.text)}</li>`
      ).join('');

    const errorHtml   = errors.length   ? `<ul style="font-size:12px;font-family:monospace;margin:6px 0;padding-left:18px">${consoleRows(errors, '#b71c1c')}</ul>` : '';
    const warningHtml = warnings.length ? `<ul style="font-size:12px;font-family:monospace;margin:6px 0;padding-left:18px">${consoleRows(warnings, '#b26a00')}</ul>` : '';
    const otherHtml   = others.length
      ? `<details style="margin-top:4px"><summary style="cursor:pointer;font-size:12px;color:#1877f2">Other logs (${others.length})</summary>
         <ul style="font-size:12px;font-family:monospace;margin:4px 0;padding-left:18px">${consoleRows(others, '#3a3b3c')}</ul></details>`
      : '';

    return `
<h2 style="margin:24px 0 6px">📜 Console Logs
  <span style="font-size:13px;font-weight:400;margin-left:8px">
    ${badge(errors.length, '#b71c1c', 'error')}${badge(warnings.length, '#b26a00', 'warning')}
  </span>
</h2>
${errorHtml}${warningHtml}${otherHtml}`;
  }

  // ── 9. Network activity ──────────────────────────────────────────────────────

  private static networkSection(pkg: FailureIntelligencePackage): string {
    const ev = pkg.evidence;
    const failures = ev.networkFailures;
    const all      = ev.networkRequests;

    const totalCount   = all.length;
    const failureCount = failures.length;
    const successCount = totalCount - failureCount;

    const headBadge = (n: number, color: string, label: string) =>
      `<span style="background:${color};color:#fff;border-radius:20px;padding:1px 8px;font-size:11px;font-weight:600">${n} ${label}</span> `;

    // Failures panel (always visible)
    const failureRows = failures.length
      ? failures.map((n) => networkRow(n, true)).join('')
      : `<tr><td colspan="4" style="padding:8px;font-size:13px;color:#65676b">No failing network requests.</td></tr>`;

    // Full requests table (collapsible)
    const allRows = all.length
      ? all.map((n) => networkRow(n, failures.some((f) => f.url === n.url && f.method === n.method))).join('')
      : `<tr><td colspan="4" style="padding:8px;font-size:13px;color:#65676b">No network requests captured.</td></tr>`;

    const tableHead = `
<thead>
  <tr style="background:#f0f2f5;font-size:12px">
    <th style="text-align:left;padding:5px 12px;color:#65676b;font-weight:600;width:60px">Method</th>
    <th style="text-align:left;padding:5px 12px;color:#65676b;font-weight:600;width:60px">Status</th>
    <th style="text-align:left;padding:5px 12px;color:#65676b;font-weight:600">URL</th>
    <th style="text-align:left;padding:5px 12px;color:#65676b;font-weight:600;width:80px">Time</th>
  </tr>
</thead>`;

    return `
<h2 style="margin:24px 0 6px">🌐 Network Activity
  <span style="font-size:13px;font-weight:400;margin-left:8px">
    ${failureCount > 0 ? headBadge(failureCount, '#b71c1c', 'failed') : ''}${successCount > 0 ? headBadge(successCount, '#1a7f37', 'ok') : ''}
  </span>
</h2>
<div style="margin-bottom:12px">
  <div style="font-weight:600;font-size:13px;margin-bottom:4px;color:#b71c1c">⚠️ Failed Requests</div>
  <table style="border-collapse:collapse;width:100%;font-size:12px;font-family:monospace">
    ${tableHead}
    <tbody>${failureRows}</tbody>
  </table>
</div>
<details>
  <summary style="cursor:pointer;font-size:13px;color:#1877f2">All requests (${totalCount})</summary>
  <table style="margin-top:6px;border-collapse:collapse;width:100%;font-size:12px;font-family:monospace">
    ${tableHead}
    <tbody>${allRows}</tbody>
  </table>
</details>`;
  }

  // ── 10. Stack trace ──────────────────────────────────────────────────────────

  private static stackSection(pkg: FailureIntelligencePackage): string {
    const callLog = pkg.evidence.playwrightCallLog?.length
      ? `<details style="margin-top:8px">
           <summary style="cursor:pointer;font-size:13px;color:#1877f2">Playwright call log (${pkg.evidence.playwrightCallLog.length} entries)</summary>
           <pre style="background:#f6f8fa;border-radius:6px;padding:10px;overflow:auto;font-size:12px">${esc(pkg.evidence.playwrightCallLog.join('\n'))}</pre>
         </details>`
      : '';
    return `
<h2 style="margin:24px 0 8px">🧵 Stack Trace</h2>
<pre style="background:#f6f8fa;border-radius:6px;padding:10px;overflow:auto;font-size:12px">${esc(pkg.errorMessage)}</pre>
${callLog}`;
  }
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:2px 12px 2px 0;color:#65676b;vertical-align:top;white-space:nowrap">${esc(label)}</td>
    <td style="padding:2px 0;font-family:monospace;word-break:break-all">${esc(value)}</td>
  </tr>`;
}

function stateRow(label: string, value: boolean): string {
  const ok    = value === true;
  const color = label === 'Disabled' || label === 'Checked'
    ? (ok ? '#b71c1c' : '#1a7f37')
    : (ok ? '#1a7f37' : '#b71c1c');
  return `<tr>
    <td style="padding:2px 12px 2px 0;color:#65676b;vertical-align:top">${esc(label)}</td>
    <td style="padding:2px 0;font-family:monospace;font-weight:600;color:${color}">${value}</td>
  </tr>`;
}

function attrRow(name: string, value: string, color?: string): string {
  const style = color ? `color:${color};font-weight:600` : 'color:#3a3b3c';
  return `<tr style="border-bottom:1px solid #f0f2f5">
    <td style="padding:3px 12px 3px 8px;font-family:monospace;font-size:12px;color:#0969da">${esc(name)}</td>
    <td style="padding:3px 8px;font-family:monospace;font-size:12px;${style}">${esc(value)}</td>
  </tr>`;
}

function networkRow(n: NetworkEntry, highlight: boolean): string {
  const method = n.method ?? 'GET';
  const status = n.status;
  const isFailed = !!n.failure;
  const time = n.timestamp ? n.timestamp.slice(11, 19) : '';

  // HTTP status badge
  let statusBadge: string;
  if (isFailed || !status) {
    statusBadge = `<span style="background:#b71c1c;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">FAILED</span>`;
  } else if (status >= 500) {
    statusBadge = `<span style="background:#b71c1c;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">${status}</span>`;
  } else if (status >= 400) {
    statusBadge = `<span style="background:#b26a00;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">${status}</span>`;
  } else if (status >= 300) {
    statusBadge = `<span style="background:#0969da;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">${status}</span>`;
  } else {
    statusBadge = `<span style="background:#1a7f37;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">${status}</span>`;
  }

  // Method badge
  const methodColors: Record<string, string> = {
    GET: '#0969da', POST: '#6f42c1', PUT: '#b26a00',
    PATCH: '#b26a00', DELETE: '#b71c1c', OPTIONS: '#65676b',
  };
  const mColor = methodColors[method] ?? '#65676b';
  const methodBadge = `<span style="color:${mColor};font-weight:600">${esc(method)}</span>`;

  const url = n.url ?? '';
  const displayUrl = url.length > 80 ? url.slice(0, 80) + '…' : url;
  const extra = isFailed && n.failure ? `<div style="color:#b71c1c;font-size:11px">${esc(n.failure)}</div>` : '';

  const rowBg = highlight ? 'background:#fff5f5;' : '';
  return `<tr style="${rowBg}border-bottom:1px solid #f0f2f5">
    <td style="padding:5px 12px;vertical-align:top">${methodBadge}</td>
    <td style="padding:5px 12px;vertical-align:top">${statusBadge}</td>
    <td style="padding:5px 12px;word-break:break-all;vertical-align:top">${esc(displayUrl)}${extra}</td>
    <td style="padding:5px 12px;color:#65676b;white-space:nowrap;vertical-align:top">${esc(time)}</td>
  </tr>`;
}

/**
 * Wrap body content in a complete, self-contained HTML document with shared
 * styles for all standalone attachment pages.
 */
function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         color: #1c1e21; margin: 0; padding: 16px 20px; line-height: 1.5; font-size: 14px; }
  h1   { font-size: 20px; margin: 0 0 12px; color: #1c1e21; }
  h2   { font-size: 15px; margin: 24px 0 8px; color: #1c1e21; border-bottom: 1px solid #ebedf0; padding-bottom: 4px; }
  pre  { background: #f6f8fa; border: 1px solid #dadde1; border-radius: 6px;
         padding: 12px; overflow: auto; font-size: 12.5px; line-height: 1.65; margin: 0; }
  section { margin-bottom: 24px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th    { text-align: left; padding: 5px 12px; background: #f0f2f5; color: #65676b; font-weight: 600; }
  td    { padding: 5px 12px; border-bottom: 1px solid #f0f2f5; vertical-align: top; }
  code  { font-family: monospace; background: #f0f2f5; padding: 1px 5px; border-radius: 4px; }
  .muted      { color: #65676b; }
  .error-note { color: #b71c1c; background: #fff5f5; border: 1px solid #f5c2c0;
                border-radius: 6px; padding: 8px 12px; font-size: 13px; margin-bottom: 16px; }
  .row-fail   { background: #fff5f5; }
  .info-table td:first-child { color: #65676b; padding-right: 20px; white-space: nowrap; }
  .info-table td:last-child  { font-family: monospace; }
  .badge { display: inline-block; border-radius: 4px; padding: 1px 7px;
           font-size: 11px; font-weight: 600; color: #fff; }
  .badge.red    { background: #b71c1c; }
  .badge.amber  { background: #b26a00; }
  .badge.green  { background: #1a7f37; }
  .badge.blue   { background: #0969da; }
  .badge.purple { background: #6f42c1; }
  .badge.muted  { background: #65676b; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${body}
</body>
</html>`;
}

/** Plain key/value table row (monospace value). */
function infoRow(label: string, value: string): string {
  return `<tr><td>${esc(label)}</td><td><code>${esc(value)}</code></td></tr>`;
}

/** Return the badge CSS class for a given HTTP method. */
function methodBadgeClass(method: string): string {
  const map: Record<string, string> = {
    GET: 'blue', POST: 'purple', PUT: 'amber',
    PATCH: 'amber', DELETE: 'red', OPTIONS: 'muted',
  };
  return map[method] ?? 'muted';
}

/** Boolean state row with colour-coded true/false. */
function stRow(label: string, value: boolean): string {
  const bad = label === 'Disabled' || label === 'Checked';
  const color = bad
    ? (value ? '#b71c1c' : '#1a7f37')
    : (value ? '#1a7f37' : '#b71c1c');
  return `<tr>
    <td>${esc(label)}</td>
    <td style="font-weight:600;color:${color};font-family:monospace">${value}</td>
  </tr>`;
}

/**
 * Escape raw HTML then apply token-level syntax colouring so it renders
 * readably inside a <pre> block without any external library.
 *
 *   <tagname   → blue bold
 *   attr=      → teal attribute names
 *   "value"    → amber attribute values
 */
function highlightHtml(raw: string): string {
  // First escape so angle brackets become &lt;/&gt; etc.
  let s = esc(raw);

  // Colour tag names: &lt;tagname  and  &lt;/tagname
  s = s.replace(/(&lt;\/?)([\w-]+)/g, (_, open, tag) =>
    `${open}<span style="color:#0969da;font-weight:600">${tag}</span>`
  );

  // Colour attribute values between &quot;...&quot; — do this BEFORE
  // attribute names so the regex range doesn't overlap.
  s = s.replace(/=(&quot;)(.*?)(&quot;)/g, (_, q1, val, q2) =>
    `=<span style="color:#b26a00">${q1}${val}${q2}</span>`
  );

  // Colour attribute names (word chars directly before =&quot; or =&#39;)
  s = s.replace(/ ([\w:-]+)(=<span)/g, (_, name, rest) =>
    ` <span style="color:#22863a">${name}</span>${rest}`
  );

  return s;
}

function list(title: string, items?: string[]): string {
  if (!items || !items.length) return '';
  const li = items.map((i) => `<li>${esc(i)}</li>`).join('');
  return `<div style="margin-bottom:10px"><strong>${esc(title)}:</strong><ul style="margin:4px 0 0;padding-left:18px">${li}</ul></div>`;
}

function bar(pct: number): string {
  return `<div style="background:#ebedf0;border-radius:4px;height:6px;margin-top:6px;overflow:hidden"><div style="width:${Math.max(0, Math.min(100, pct))}%;height:6px;background:${confColor(pct)}"></div></div>`;
}

function confColor(pct: number): string {
  if (pct >= 75) return '#b71c1c';
  if (pct >= 45) return '#b26a00';
  return '#65676b';
}
