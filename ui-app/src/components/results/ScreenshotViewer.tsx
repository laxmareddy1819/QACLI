import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { useState } from 'react';

interface Props {
  /** Relative path — used with /api/files/ prefix (legacy) */
  path?: string;
  /** Direct URL to the image (e.g. /api/results/artifact?path=...) */
  url?: string;
  testName: string;
  onClose: () => void;
}

export function ScreenshotViewer({ path, url, testName, onClose }: Props) {
  const [zoom, setZoom] = useState(1);

  const imgSrc = url || `/api/files/${encodeURIComponent(path || '')}`;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-1 rounded-xl border border-white/10 max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-white/5">
          <p className="text-sm text-gray-200 truncate">{testName}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="text-gray-500 hover:text-gray-300"><ZoomOut size={16} /></button>
            <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="text-gray-500 hover:text-gray-300"><ZoomIn size={16} /></button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 ml-2"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
          <img
            src={imgSrc}
            alt={`Screenshot for ${testName}`}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
            className="max-w-full transition-transform"
          />
        </div>
      </div>
    </div>
  );
}
