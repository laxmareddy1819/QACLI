import type { FileMetadata } from '../../api/types';

interface ApiEndpointViewerProps {
  content: string;
  metadata: FileMetadata;
}

const methodColors: Record<string, string> = {
  GET: 'text-emerald-400 bg-emerald-400/10',
  POST: 'text-amber-400 bg-amber-400/10',
  PUT: 'text-sky-400 bg-sky-400/10',
  PATCH: 'text-violet-400 bg-violet-400/10',
  DELETE: 'text-red-400 bg-red-400/10',
};

export function ApiEndpointViewer({ metadata }: ApiEndpointViewerProps) {
  const endpoints = metadata.metadata?.endpoints ?? [];

  if (endpoints.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        No API endpoints detected in this file.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">
        Detected Endpoints ({endpoints.length})
      </h3>
      {endpoints.map((ep, i) => {
        const method = ep.method.toUpperCase();
        const colors = methodColors[method] ?? 'text-gray-400 bg-gray-400/10';

        return (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-2 border border-white/5"
          >
            <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${colors}`}>
              {method}
            </span>
            <span className="text-sm text-gray-200 font-mono flex-1 truncate">{ep.url}</span>
          </div>
        );
      })}
    </div>
  );
}
