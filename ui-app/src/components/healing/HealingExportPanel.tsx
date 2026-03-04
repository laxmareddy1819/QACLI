import { useState } from 'react';
import { FileDown, FileJson, FileSpreadsheet, FileText, AlertCircle, Download } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export function HealingExportPanel({ days }: { days: number }) {
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: 'json' | 'csv' | 'html') => {
    setExporting(format);
    setError(null);

    try {
      const token = localStorage.getItem('qabot_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const resp = await fetch(`${API_BASE}/api/heal/export?format=${format}&days=${days}`, { headers });
      if (!resp.ok) throw new Error(`Export failed: ${resp.statusText}`);

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `healing-report-${days}d.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-200 mb-2">Export Healing Report</h3>
        <p className="text-xs text-gray-400 mb-4">
          Download a comprehensive healing report for the last {days} days. Choose your preferred format below.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {/* JSON Export */}
        <button
          onClick={() => handleExport('json')}
          disabled={exporting !== null}
          className="bg-surface-1 rounded-xl border border-white/5 p-6 text-left hover:border-blue-500/30 hover:bg-blue-500/5 transition-all group disabled:opacity-50"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <FileJson size={20} className="text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200">JSON</p>
              <p className="text-[10px] text-gray-500">Structured data format</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mb-4">
            Complete report with all analytics, events, strategy/framework breakdowns, and injected projects.
            Ideal for programmatic processing.
          </p>
          <div className="flex items-center gap-2 text-xs text-blue-400 group-hover:text-blue-300">
            <Download size={14} />
            {exporting === 'json' ? 'Exporting...' : 'Download JSON'}
          </div>
        </button>

        {/* CSV Export */}
        <button
          onClick={() => handleExport('csv')}
          disabled={exporting !== null}
          className="bg-surface-1 rounded-xl border border-white/5 p-6 text-left hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all group disabled:opacity-50"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <FileSpreadsheet size={20} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200">CSV</p>
              <p className="text-[10px] text-gray-500">Spreadsheet format</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mb-4">
            Healing events as a flat CSV table. Import into Excel, Google Sheets, or data analysis tools.
          </p>
          <div className="flex items-center gap-2 text-xs text-emerald-400 group-hover:text-emerald-300">
            <Download size={14} />
            {exporting === 'csv' ? 'Exporting...' : 'Download CSV'}
          </div>
        </button>

        {/* HTML Export */}
        <button
          onClick={() => handleExport('html')}
          disabled={exporting !== null}
          className="bg-surface-1 rounded-xl border border-white/5 p-6 text-left hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group disabled:opacity-50"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <FileText size={20} className="text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200">HTML</p>
              <p className="text-[10px] text-gray-500">Visual report</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mb-4">
            Beautiful HTML report with cards, tables, and color-coded status. Share with stakeholders or archive.
          </p>
          <div className="flex items-center gap-2 text-xs text-violet-400 group-hover:text-violet-300">
            <Download size={14} />
            {exporting === 'html' ? 'Exporting...' : 'Download HTML'}
          </div>
        </button>
      </div>

      <div className="bg-surface-1 rounded-xl border border-white/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <FileDown size={14} className="text-gray-500" />
          <p className="text-xs font-medium text-gray-300">API Endpoint</p>
        </div>
        <p className="text-[11px] text-gray-400 mb-2">
          You can also export programmatically using the API:
        </p>
        <code className="block text-[11px] bg-surface-0 rounded-lg p-3 text-brand-300 font-mono">
          GET /api/heal/export?format=json|csv|html&days={days}
        </code>
      </div>
    </div>
  );
}
