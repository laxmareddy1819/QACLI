import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StoredRun, StoredTestCase, FailureGroup } from '../types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HumanStep {
  keyword: string;
  name: string;
  line: number;
}

export interface ReportOptions {
  embedScreenshots?: boolean;
  maxScreenshotBytes?: number;
  projectPath?: string;
  /** Pre-computed human-readable steps keyed by test name */
  humanStepsMap?: Map<string, HumanStep[]>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDuration(ms?: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function statusIcon(status: string): string {
  if (status === 'passed') return '✓';
  if (status === 'failed' || status === 'error') return '✗';
  if (status === 'skipped') return '—';
  return '?';
}

function statusClass(status: string): string {
  if (status === 'passed') return 'passed';
  if (status === 'failed' || status === 'error') return 'failed';
  return 'skipped';
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = { bug: '🐛 Bug', environment: '🌐 Environment', flaky: '🔀 Flaky', 'test-issue': '🔧 Test Issue', timeout: '⏱ Timeout', unknown: '❓ Unknown' };
  return map[cat] || cat;
}

function embedScreenshot(path: string, projectPath: string, maxBytes: number): string | null {
  try {
    const fullPath = resolve(projectPath, path);
    if (!existsSync(fullPath)) return null;
    const stats = statSync(fullPath);
    if (stats.size > maxBytes) return null;
    const buffer = readFileSync(fullPath);
    const ext = path.match(/\.jpe?g$/i) ? 'jpeg' : 'png';
    return `data:image/${ext};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;background:#f8fafc;color:#1e293b;line-height:1.5;font-size:14px}
.container{max-width:1100px;margin:0 auto;padding:24px 20px}

/* Header */
.header{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:32px 0;margin-bottom:24px;border-radius:0 0 16px 16px}
.header .container{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.header h1{font-size:22px;font-weight:700}
.header .subtitle{font-size:13px;opacity:0.85;margin-top:4px}
.header .meta{font-size:12px;opacity:0.7;text-align:right}
.header .meta div{margin-bottom:2px}

/* Summary Cards */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center}
.card .label{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:4px}
.card .value{font-size:28px;font-weight:700;color:#1e293b}
.card.passed .value{color:#10b981}
.card.failed .value{color:#ef4444}
.card.skipped .value{color:#6b7280}
.card.rate .value{color:#4f46e5}

/* Donut */
.donut-wrap{display:flex;align-items:center;justify-content:center;gap:20px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px}
.donut{width:100px;height:100px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#1e293b}
.donut-legend{font-size:13px;color:#64748b}
.donut-legend div{margin:3px 0;display:flex;align-items:center;gap:8px}
.donut-legend .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}

/* Section headings */
.section{margin-bottom:24px}
.section h2{font-size:16px;font-weight:700;color:#1e293b;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e2e8f0}

/* Filters */
.filters{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.filter-btn{padding:5px 14px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;font-size:12px;font-weight:500;cursor:pointer;color:#64748b;transition:all .15s}
.filter-btn:hover{border-color:#a5b4fc;color:#4f46e5}
.filter-btn.active{background:#4f46e5;color:#fff;border-color:#4f46e5}

/* Table */
.table-wrap{overflow-x:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px}
table{width:100%;border-collapse:collapse}
th{background:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;padding:10px 14px;text-align:left;cursor:pointer;user-select:none;white-space:nowrap}
th:hover{color:#4f46e5}
td{padding:10px 14px;border-top:1px solid #f1f5f9;font-size:13px}
tr:hover{background:#f8fafc}
.status-cell{font-weight:700;width:36px;text-align:center;font-size:16px}
.status-cell.passed{color:#10b981}
.status-cell.failed{color:#ef4444}
.status-cell.skipped{color:#6b7280}
.test-name{font-weight:500;color:#1e293b;max-width:400px}
.suite-cell{color:#64748b;font-size:12px}
.duration-cell{color:#64748b;font-size:12px;white-space:nowrap}
.browser-cell{color:#64748b;font-size:12px}

/* Failure Details */
.failure-card{background:#fff;border:1px solid #fecaca;border-radius:12px;padding:16px;margin-bottom:12px}
.failure-card h3{font-size:14px;font-weight:600;color:#dc2626;margin-bottom:4px}
.failure-card .suite-info{font-size:12px;color:#64748b;margin-bottom:10px}
.error-msg{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#991b1b;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;margin-bottom:8px}
details{margin-bottom:8px}
summary{font-size:12px;color:#64748b;cursor:pointer;padding:4px 0}
summary:hover{color:#4f46e5}
.stack-trace{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#475569;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto}
.screenshot{margin:8px 0;max-width:100%;border:1px solid #e2e8f0;border-radius:8px}
.screenshot img{max-width:100%;border-radius:8px;display:block}
.no-screenshot{font-size:12px;color:#94a3b8;font-style:italic}

/* Steps */
.steps-table{width:100%;border-collapse:collapse;margin:8px 0}
.steps-table th{background:#f8fafc;font-size:10px;padding:6px 10px}
.steps-table td{padding:6px 10px;font-size:12px;border-top:1px solid #f1f5f9}
.step-keyword{font-weight:600;color:#4f46e5;font-size:11px;white-space:nowrap}
.step-passed{color:#10b981}
.step-failed{color:#ef4444}

/* Test Detail Cards */
.test-detail-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:10px}
.test-detail-card.test-passed{border-left:3px solid #10b981}
.test-detail-card.test-failed{border-left:3px solid #ef4444}
.test-detail-card.test-skipped{border-left:3px solid #6b7280}
.test-detail-header{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer}
.test-detail-header h3{font-size:13px;font-weight:600;color:#1e293b;margin:0;flex:1}
.test-detail-status{font-size:14px;font-weight:700;flex-shrink:0}
.test-detail-status.passed{color:#10b981}
.test-detail-status.failed{color:#ef4444}
.test-detail-status.skipped{color:#6b7280}
.test-detail-meta{font-size:11px;color:#64748b;margin-top:4px}
.test-detail-body{margin-top:12px;border-top:1px solid #f1f5f9;padding-top:12px}

/* Human Steps */
.human-steps{margin:8px 0}
.human-steps .step-row{display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-radius:6px}
.human-steps .step-row:nth-child(odd){background:#f8fafc}
.human-steps .step-num{font-size:10px;color:#94a3b8;width:18px;text-align:right;flex-shrink:0;margin-top:2px}
.human-steps .step-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;flex-shrink:0;text-transform:uppercase}
.human-steps .step-badge.action{background:#eff6ff;color:#2563eb}
.human-steps .step-badge.assert{background:#f0fdf4;color:#16a34a}
.human-steps .step-badge.comment{background:#f5f3ff;color:#7c3aed}
.human-steps .step-badge.setup{background:#fff7ed;color:#ea580c}
.human-steps .step-text{font-size:12px;color:#334155;flex:1}

/* Analysis */
.analysis-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px}
.analysis-card .category{display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;margin-bottom:8px}
.cat-bug{background:#fef2f2;color:#dc2626}
.cat-environment{background:#f0f9ff;color:#0284c7}
.cat-flaky{background:#fffbeb;color:#d97706}
.cat-test-issue{background:#fff7ed;color:#ea580c}
.cat-timeout{background:#faf5ff;color:#9333ea}
.cat-unknown{background:#f1f5f9;color:#64748b}
.analysis-card h3{font-size:14px;font-weight:600;color:#1e293b;margin-bottom:8px}
.analysis-card .root-cause,.analysis-card .suggested-fix{font-size:13px;color:#475569;margin-bottom:8px;padding:8px 12px;background:#f8fafc;border-radius:8px}
.analysis-card .affected{font-size:12px;color:#64748b}

/* Cloud badge */
.cloud-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:600;background:#eff6ff;color:#2563eb}

/* Footer */
.footer{text-align:center;padding:24px 0;color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;margin-top:32px}

/* Print */
@media print{
  body{background:#fff}
  .header{border-radius:0;page-break-after:avoid}
  .filters,.filter-btn{display:none!important}
  .failure-card,.analysis-card{break-inside:avoid}
  .table-wrap{border:none}
  th{background:#f1f5f9!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;

// ── Inline JS ────────────────────────────────────────────────────────────────

const SCRIPT = `
(function(){
  // Filter
  var btns=document.querySelectorAll('[data-filter]');
  btns.forEach(function(b){
    b.addEventListener('click',function(){
      var f=b.getAttribute('data-filter');
      btns.forEach(function(x){x.classList.remove('active')});
      b.classList.add('active');
      document.querySelectorAll('#test-tbody tr').forEach(function(r){
        r.style.display=(!f||r.getAttribute('data-status')===f)?'':'none';
      });
      // Also filter test detail cards
      document.querySelectorAll('.test-detail-card').forEach(function(c){
        c.style.display=(!f||c.getAttribute('data-status')===f)?'':'none';
      });
    });
  });
  // Sort
  var dir={};
  document.querySelectorAll('[data-sort]').forEach(function(th){
    th.addEventListener('click',function(){
      var col=th.getAttribute('data-sort');
      dir[col]=!dir[col];
      var tbody=document.getElementById('test-tbody');
      var rows=Array.from(tbody.querySelectorAll('tr'));
      rows.sort(function(a,b){
        var av=a.getAttribute('data-'+col)||'';
        var bv=b.getAttribute('data-'+col)||'';
        if(col==='duration'){av=parseFloat(av)||0;bv=parseFloat(bv)||0;return dir[col]?av-bv:bv-av;}
        return dir[col]?av.localeCompare(bv):bv.localeCompare(av);
      });
      rows.forEach(function(r){tbody.appendChild(r)});
    });
  });
  // Toggle test detail bodies
  document.querySelectorAll('.test-detail-header').forEach(function(h){
    h.addEventListener('click',function(){
      var body=h.parentElement.querySelector('.test-detail-body');
      var arrow=h.querySelector('.toggle-arrow');
      if(body){
        var vis=body.style.display!=='none';
        body.style.display=vis?'none':'block';
        if(arrow)arrow.textContent=vis?'\\u25B6':'\\u25BC';
      }
    });
  });
})();
`;

// ── Generator ────────────────────────────────────────────────────────────────

export function generateHtmlReport(run: StoredRun, options?: ReportOptions): string {
  const embedScreenshots = options?.embedScreenshots !== false;
  const maxScreenshotBytes = options?.maxScreenshotBytes ?? 512_000;
  const projectPath = options?.projectPath || run.projectPath || '';

  const s = run.summary || { total: 0, passed: 0, failed: 0, skipped: 0, passRate: 0 };
  const failedTests = (run.tests || []).filter(t => t.status === 'failed' || t.status === 'error');
  const framework = run.framework || 'Unknown';
  const dateStr = fmtTimestamp(run.startTime);

  const cloudLabels: Record<string, string> = { browserstack: 'BrowserStack', lambdatest: 'LambdaTest', saucelabs: 'Sauce Labs' };

  let html = '';

  // ── DOCTYPE + Head ──────────────────────────────────────────────────────
  html += `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Test Report — ${esc(framework)} — ${esc(dateStr)}</title>
<style>${CSS}</style>
</head>
<body>
`;

  // ── Header Banner ───────────────────────────────────────────────────────
  html += `<div class="header"><div class="container">
<div>
  <h1>📊 Test Report</h1>
  <div class="subtitle">${esc(framework)} — ${esc(dateStr)}</div>
</div>
<div class="meta">
  <div>Status: <strong>${esc(run.status)}</strong></div>
  <div>Duration: <strong>${fmtDuration(run.duration)}</strong></div>`;
  if (run.source === 'cloud' && run.cloudProvider) {
    html += `\n  <div><span class="cloud-badge" style="background:rgba(255,255,255,0.2);color:#fff">☁ ${esc(cloudLabels[run.cloudProvider] || run.cloudProvider)}</span></div>`;
  }
  html += `\n</div>
</div></div>
`;

  html += '<div class="container">';

  // ── Executive Summary ───────────────────────────────────────────────────
  // Donut chart
  const passAngle = Math.round((s.passed / (s.total || 1)) * 360);
  const failAngle = Math.round((s.failed / (s.total || 1)) * 360);
  const passRateColor = s.passRate >= 90 ? '#10b981' : s.passRate >= 70 ? '#d97706' : '#ef4444';

  html += `<div class="donut-wrap">
<div class="donut" style="background:conic-gradient(#10b981 0deg ${passAngle}deg,#ef4444 ${passAngle}deg ${passAngle + failAngle}deg,#6b7280 ${passAngle + failAngle}deg 360deg)">
  <span style="background:#fff;border-radius:50%;width:70px;height:70px;display:flex;align-items:center;justify-content:center;color:${passRateColor}">${s.passRate}%</span>
</div>
<div class="donut-legend">
  <div><span class="dot" style="background:#10b981"></span> Passed: <strong>${s.passed}</strong></div>
  <div><span class="dot" style="background:#ef4444"></span> Failed: <strong>${s.failed}</strong></div>
  <div><span class="dot" style="background:#6b7280"></span> Skipped: <strong>${s.skipped}</strong></div>
  <div style="margin-top:6px;color:#1e293b"><strong>${s.total}</strong> total tests</div>
</div>
</div>
`;

  // Stat cards
  html += `<div class="cards">
<div class="card"><div class="label">Total</div><div class="value">${s.total}</div></div>
<div class="card passed"><div class="label">Passed</div><div class="value">${s.passed}</div></div>
<div class="card failed"><div class="label">Failed</div><div class="value">${s.failed}</div></div>
<div class="card skipped"><div class="label">Skipped</div><div class="value">${s.skipped}</div></div>
<div class="card rate"><div class="label">Pass Rate</div><div class="value">${s.passRate}%</div></div>
<div class="card"><div class="label">Duration</div><div class="value" style="font-size:20px">${fmtDuration(run.duration)}</div></div>
</div>
`;

  // Run info
  html += '<div class="section"><h2>Run Information</h2>';
  html += '<table class="table-wrap" style="border-collapse:collapse"><tbody>';
  html += `<tr><td style="padding:8px 14px;font-weight:600;color:#64748b;width:140px">Framework</td><td style="padding:8px 14px">${esc(framework)}</td></tr>`;
  html += `<tr><td style="padding:8px 14px;font-weight:600;color:#64748b">Command</td><td style="padding:8px 14px;font-family:monospace;font-size:12px">${esc(run.command)}</td></tr>`;
  html += `<tr><td style="padding:8px 14px;font-weight:600;color:#64748b">Started</td><td style="padding:8px 14px">${esc(fmtTimestamp(run.startTime))}</td></tr>`;
  if (run.endTime) html += `<tr><td style="padding:8px 14px;font-weight:600;color:#64748b">Ended</td><td style="padding:8px 14px">${esc(fmtTimestamp(run.endTime))}</td></tr>`;
  if (run.source === 'cloud' && run.cloudProvider) {
    html += `<tr><td style="padding:8px 14px;font-weight:600;color:#64748b">Cloud Provider</td><td style="padding:8px 14px"><span class="cloud-badge">${esc(cloudLabels[run.cloudProvider] || run.cloudProvider)}</span></td></tr>`;
  }
  if (run.cloudBuildName) html += `<tr><td style="padding:8px 14px;font-weight:600;color:#64748b">Build Name</td><td style="padding:8px 14px">${esc(run.cloudBuildName)}</td></tr>`;
  html += '</tbody></table></div>';

  // ── Test Results Table ──────────────────────────────────────────────────
  html += '<div class="section"><h2>Test Results</h2>';
  html += `<div class="filters">
<button class="filter-btn active" data-filter="">All (${s.total})</button>
<button class="filter-btn" data-filter="passed">Passed (${s.passed})</button>
<button class="filter-btn" data-filter="failed">Failed (${s.failed})</button>
<button class="filter-btn" data-filter="skipped">Skipped (${s.skipped})</button>
</div>
`;

  html += '<div class="table-wrap"><table>';
  html += '<thead><tr>';
  html += '<th style="width:36px">Status</th>';
  html += '<th data-sort="name">Test Name ↕</th>';
  html += '<th data-sort="suite">Suite ↕</th>';
  html += '<th>Browser</th>';
  html += '<th data-sort="duration">Duration ↕</th>';
  html += '</tr></thead>';
  html += '<tbody id="test-tbody">';

  for (const t of (run.tests || [])) {
    const sc = statusClass(t.status);
    html += `<tr data-status="${sc}" data-name="${esc(t.name)}" data-suite="${esc(t.suite || '')}" data-duration="${t.duration || 0}">`;
    html += `<td class="status-cell ${sc}">${statusIcon(t.status)}</td>`;
    html += `<td class="test-name">${esc(t.name)}`;
    if (t.errorMessage && (t.status === 'failed' || t.status === 'error')) {
      const preview = t.errorMessage.split('\n')[0]?.slice(0, 80) || '';
      html += `<div style="font-size:11px;color:#ef4444;margin-top:2px">${esc(preview)}</div>`;
    }
    html += '</td>';
    html += `<td class="suite-cell">${esc(t.suite || '—')}</td>`;
    html += `<td class="browser-cell">${esc(t.browser || '—')}</td>`;
    html += `<td class="duration-cell">${fmtDuration(t.duration)}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table></div></div>';

  // ── Test Details with Steps ───────────────────────────────────────────
  const humanStepsMap = options?.humanStepsMap;
  const testsWithSteps = (run.tests || []).filter(t =>
    (t.steps && t.steps.length > 0) || (humanStepsMap && humanStepsMap.has(t.name)),
  );

  if (testsWithSteps.length > 0) {
    html += `<div class="section"><h2>Test Details &amp; Steps (${testsWithSteps.length})</h2>`;
    html += `<div class="filters">
<button class="filter-btn active" data-filter="">All (${testsWithSteps.length})</button>
<button class="filter-btn" data-filter="passed">Passed</button>
<button class="filter-btn" data-filter="failed">Failed</button>
<button class="filter-btn" data-filter="skipped">Skipped</button>
</div>`;

    for (const t of testsWithSteps) {
      const sc = statusClass(t.status);
      const hasExecSteps = t.steps && t.steps.length > 0;
      const hSteps = humanStepsMap?.get(t.name);
      const hasHumanSteps = hSteps && hSteps.length > 0;

      html += `<div class="test-detail-card test-${sc}" data-status="${sc}">`;
      html += `<div class="test-detail-header">`;
      html += `<span class="toggle-arrow" style="font-size:11px;color:#94a3b8;flex-shrink:0">▶</span>`;
      html += `<h3>${esc(t.name)}</h3>`;
      html += `<span class="test-detail-status ${sc}">${statusIcon(t.status)}</span>`;
      html += `</div>`;
      if (t.suite || t.file || t.duration) {
        html += '<div class="test-detail-meta">';
        if (t.suite) html += `${esc(t.suite)}`;
        if (t.suite && t.file) html += ' · ';
        if (t.file) html += `${esc(t.file)}`;
        if (t.duration) html += ` · ${fmtDuration(t.duration)}`;
        html += '</div>';
      }

      // Body (collapsed by default)
      html += '<div class="test-detail-body" style="display:none">';

      // Human-readable steps (from source code analysis)
      if (hasHumanSteps) {
        html += '<div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Test Steps</div>';
        html += '<div class="human-steps">';
        hSteps!.forEach((step, i) => {
          const kwLower = step.keyword.toLowerCase();
          const badgeClass = kwLower === 'action' ? 'action' : kwLower === 'assert' ? 'assert' : kwLower === 'comment' ? 'comment' : kwLower === 'setup' ? 'setup' : 'action';
          html += `<div class="step-row">`;
          html += `<span class="step-num">${i + 1}</span>`;
          html += `<span class="step-badge ${badgeClass}">${esc(step.keyword)}</span>`;
          html += `<span class="step-text">${esc(step.name)}</span>`;
          html += '</div>';
        });
        html += '</div>';
      }

      // BDD execution steps (from test run output)
      if (hasExecSteps) {
        if (hasHumanSteps) {
          html += '<div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px">Execution Steps</div>';
        }
        html += '<table class="steps-table"><thead><tr><th>Keyword</th><th>Step</th><th>Status</th><th>Duration</th></tr></thead><tbody>';
        for (const step of t.steps!) {
          const stepSc = step.status === 'passed' ? 'step-passed' : step.status === 'failed' ? 'step-failed' : '';
          html += `<tr><td class="step-keyword">${esc(step.keyword)}</td><td>${esc(step.name)}</td><td class="${stepSc}">${esc(step.status)}</td><td class="duration-cell">${fmtDuration(step.duration)}</td></tr>`;
          if (step.errorMessage) {
            html += `<tr><td colspan="4"><div class="error-msg" style="margin:4px 0">${esc(step.errorMessage)}</div></td></tr>`;
          }
        }
        html += '</tbody></table>';
      }

      // Error message (for failed tests)
      if (t.errorMessage && (t.status === 'failed' || t.status === 'error')) {
        html += `<div style="margin-top:8px"><div style="font-size:11px;font-weight:600;color:#dc2626;margin-bottom:4px">Error</div><div class="error-msg">${esc(t.errorMessage)}</div></div>`;
      }

      // Screenshot
      if (t.screenshotPath && embedScreenshots && projectPath) {
        const dataUri = embedScreenshot(t.screenshotPath, projectPath, maxScreenshotBytes);
        if (dataUri) {
          html += `<div class="screenshot" style="margin-top:8px"><img src="${dataUri}" alt="Screenshot for ${esc(t.name)}" /></div>`;
        }
      }

      html += '</div>'; // close .test-detail-body
      html += '</div>'; // close .test-detail-card
    }
    html += '</div>';
  }

  // ── Failure Details ─────────────────────────────────────────────────────
  if (failedTests.length > 0) {
    html += `<div class="section"><h2>Failure Details (${failedTests.length})</h2>`;
    for (const t of failedTests) {
      html += '<div class="failure-card">';
      html += `<h3>${statusIcon(t.status)} ${esc(t.name)}</h3>`;
      if (t.suite || t.file) {
        html += `<div class="suite-info">${t.suite ? esc(t.suite) : ''}${t.suite && t.file ? ' · ' : ''}${t.file ? esc(t.file) : ''}</div>`;
      }
      if (t.errorMessage) {
        html += `<div class="error-msg">${esc(t.errorMessage)}</div>`;
      }
      if (t.stackTrace) {
        html += `<details><summary>Stack Trace</summary><pre class="stack-trace">${esc(t.stackTrace)}</pre></details>`;
      }

      // BDD steps
      if (t.steps && t.steps.length > 0) {
        html += '<details open><summary>Execution Steps</summary><table class="steps-table"><thead><tr><th>Keyword</th><th>Step</th><th>Status</th><th>Duration</th></tr></thead><tbody>';
        for (const step of t.steps) {
          const stepSc = step.status === 'passed' ? 'step-passed' : step.status === 'failed' ? 'step-failed' : '';
          html += `<tr><td class="step-keyword">${esc(step.keyword)}</td><td>${esc(step.name)}</td><td class="${stepSc}">${esc(step.status)}</td><td class="duration-cell">${fmtDuration(step.duration)}</td></tr>`;
          if (step.errorMessage) {
            html += `<tr><td colspan="4"><div class="error-msg" style="margin:4px 0">${esc(step.errorMessage)}</div></td></tr>`;
          }
        }
        html += '</tbody></table></details>';
      }

      // Screenshot
      if (t.screenshotPath && embedScreenshots && projectPath) {
        const dataUri = embedScreenshot(t.screenshotPath, projectPath, maxScreenshotBytes);
        if (dataUri) {
          html += `<div class="screenshot"><img src="${dataUri}" alt="Screenshot for ${esc(t.name)}" /></div>`;
        } else {
          html += `<div class="no-screenshot">Screenshot: ${esc(t.screenshotPath)} (not available or too large)</div>`;
        }
      }

      html += '</div>';
    }
    html += '</div>';
  }

  // ── Failure Analysis ────────────────────────────────────────────────────
  if (run.failureAnalysis && run.failureAnalysis.length > 0) {
    html += `<div class="section"><h2>AI Failure Analysis (${run.failureAnalysis.length} groups)</h2>`;
    for (const group of run.failureAnalysis) {
      const catClass = `cat-${group.category}`;
      html += '<div class="analysis-card">';
      html += `<span class="category ${catClass}">${categoryLabel(group.category)}</span>`;
      html += `<span style="margin-left:8px;font-size:12px;color:#64748b">${group.count} test${group.count > 1 ? 's' : ''} affected</span>`;
      html += `<h3 style="margin-top:8px">${esc(group.errorSignature)}</h3>`;
      if (group.rootCause) {
        html += `<div class="root-cause"><strong>Root Cause:</strong> ${esc(group.rootCause)}</div>`;
      }
      if (group.suggestedFix) {
        html += `<div class="suggested-fix"><strong>Suggested Fix:</strong> ${esc(group.suggestedFix)}</div>`;
      }
      if (group.affectedTests.length > 0) {
        html += '<div class="affected"><strong>Affected Tests:</strong><ul style="margin:4px 0 0 16px">';
        for (const name of group.affectedTests) {
          html += `<li>${esc(name)}</li>`;
        }
        html += '</ul></div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }

  // ── Cloud Artifacts ─────────────────────────────────────────────────────
  if (run.cloudArtifacts?.sessions && run.cloudArtifacts.sessions.length > 0) {
    html += '<div class="section"><h2>Cloud Sessions</h2>';
    for (const session of run.cloudArtifacts.sessions) {
      html += '<div class="analysis-card">';
      html += `<div style="font-size:13px"><strong>${esc(session.browser || 'Unknown')}</strong>`;
      if (session.os) html += ` — ${esc(session.os)} ${esc(session.osVersion || '')}`;
      if (session.status) html += ` — <span style="font-weight:600">${esc(session.status)}</span>`;
      if (session.duration != null) html += ` — ${session.duration}s`;
      html += '</div>';
      html += '<div style="margin-top:8px;font-size:12px">';
      if (session.sessionUrl) html += `<a href="${esc(session.sessionUrl)}" target="_blank" style="color:#4f46e5;margin-right:12px">Session</a>`;
      if (session.videoUrl) html += `<a href="${esc(session.videoUrl)}" target="_blank" style="color:#4f46e5;margin-right:12px">Video</a>`;
      if (session.logsUrl) html += `<a href="${esc(session.logsUrl)}" target="_blank" style="color:#4f46e5;margin-right:12px">Logs</a>`;
      html += '</div></div>';
    }
    html += '</div>';
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  html += `<div class="footer">
Generated by <strong>qabot</strong> — ${esc(fmtTimestamp(new Date().toISOString()))}
</div>
`;

  html += '</div>'; // close .container
  html += `<script>${SCRIPT}</script>`;
  html += '\n</body>\n</html>';

  return html;
}
