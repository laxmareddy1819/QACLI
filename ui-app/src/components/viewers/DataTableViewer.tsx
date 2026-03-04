import { useState } from 'react';
import { Table, Code } from 'lucide-react';

interface DataTableViewerProps {
  content: string;
  language: string; // json, yaml, csv
}

export function DataTableViewer({ content, language }: DataTableViewerProps) {
  const [viewMode, setViewMode] = useState<'table' | 'raw'>('table');

  if (viewMode === 'raw' || language === 'yaml') {
    return (
      <div className="h-full flex flex-col">
        <ViewToggle mode={viewMode} onToggle={setViewMode} />
        <pre className="flex-1 overflow-auto p-4 text-sm text-gray-300 font-mono whitespace-pre">{content}</pre>
      </div>
    );
  }

  // Try to parse as table
  if (language === 'json') {
    return <JsonTableView content={content} mode={viewMode} onToggle={setViewMode} />;
  }

  if (language === 'csv') {
    return <CsvTableView content={content} mode={viewMode} onToggle={setViewMode} />;
  }

  return <pre className="p-4 text-sm text-gray-300 font-mono overflow-auto h-full">{content}</pre>;
}

function ViewToggle({ mode, onToggle }: { mode: 'table' | 'raw'; onToggle: (m: 'table' | 'raw') => void }) {
  return (
    <div className="flex gap-1 p-2 border-b border-white/5">
      <button
        onClick={() => onToggle('table')}
        className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
          mode === 'table' ? 'bg-brand-500/20 text-brand-300' : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Table size={12} /> Table
      </button>
      <button
        onClick={() => onToggle('raw')}
        className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
          mode === 'raw' ? 'bg-brand-500/20 text-brand-300' : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Code size={12} /> Raw
      </button>
    </div>
  );
}

function JsonTableView({ content, mode, onToggle }: { content: string; mode: 'table' | 'raw'; onToggle: (m: 'table' | 'raw') => void }) {
  let data: unknown;
  try { data = JSON.parse(content); } catch { data = null; }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <ViewToggle mode={mode} onToggle={onToggle} />
        <pre className="flex-1 overflow-auto p-4 text-sm text-gray-300 font-mono whitespace-pre">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  const headers = Object.keys(data[0] as Record<string, unknown>);

  return (
    <div className="h-full flex flex-col">
      <ViewToggle mode={mode} onToggle={onToggle} />
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              {headers.map((h) => (
                <th key={h} className="text-left px-3 py-2 text-gray-400 font-medium border-b border-white/5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data as Record<string, unknown>[]).map((row, i) => (
              <tr key={i} className="hover:bg-white/5">
                {headers.map((h) => (
                  <td key={h} className="px-3 py-1.5 text-gray-300 border-b border-white/3">{String(row[h] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 border-t border-white/5 text-[10px] text-gray-500">
        {(data as unknown[]).length} rows, {headers.length} columns
      </div>
    </div>
  );
}

function CsvTableView({ content, mode, onToggle }: { content: string; mode: 'table' | 'raw'; onToggle: (m: 'table' | 'raw') => void }) {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    return (
      <div className="h-full flex flex-col">
        <ViewToggle mode={mode} onToggle={onToggle} />
        <pre className="flex-1 overflow-auto p-4 text-sm text-gray-300 font-mono">{content}</pre>
      </div>
    );
  }

  const headers = lines[0]!.split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim()));

  return (
    <div className="h-full flex flex-col">
      <ViewToggle mode={mode} onToggle={onToggle} />
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="text-left px-3 py-2 text-gray-400 font-medium border-b border-white/5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-white/5">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 text-gray-300 border-b border-white/3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 border-t border-white/5 text-[10px] text-gray-500">
        {rows.length} rows, {headers.length} columns
      </div>
    </div>
  );
}
