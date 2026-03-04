import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { computeJsonPath, getValueDisplay, isLeafValue } from './utils/json-path-utils';

interface ResponseJsonPickerProps {
  data: unknown;
  onSelectPath: (path: string, value: unknown) => void;
  rootPath?: string;
}

export function ResponseJsonPicker({ data, onSelectPath, rootPath = '$' }: ResponseJsonPickerProps) {
  // Parse if string
  let parsed = data;
  if (typeof data === 'string') {
    try { parsed = JSON.parse(data); } catch { /* use as-is */ }
  }

  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    const display = getValueDisplay(parsed);
    return (
      <button
        onClick={() => onSelectPath(rootPath, parsed)}
        className={`text-[11px] font-mono ${display.color} hover:bg-white/10 px-1 rounded cursor-pointer transition-colors`}
      >
        {display.text}
      </button>
    );
  }

  return (
    <div className="text-[11px] font-mono">
      <JsonNode
        value={parsed}
        path={rootPath}
        onSelectPath={onSelectPath}
        depth={0}
        isRoot
      />
    </div>
  );
}

function JsonNode({
  value, path, onSelectPath, depth, isRoot, keyName,
}: {
  value: unknown;
  path: string;
  onSelectPath: (path: string, value: unknown) => void;
  depth: number;
  isRoot?: boolean;
  keyName?: string | number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (isLeafValue(value)) {
    const display = getValueDisplay(value);
    return (
      <div className="flex items-center gap-1 py-0.5 group" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-gray-400">{typeof keyName === 'number' ? `${keyName}:` : `"${keyName}":`}</span>
        )}
        <button
          onClick={() => onSelectPath(path, value)}
          className={`${display.color} hover:bg-brand-500/20 px-1 rounded cursor-pointer transition-colors border border-transparent hover:border-brand-500/30`}
          title={`Click to select: ${path}`}
        >
          {display.text}
        </button>
        <span className="text-gray-700 opacity-0 group-hover:opacity-100 text-[9px] transition-opacity ml-1">
          {path}
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [i, v] as [number, unknown])
    : Object.entries(value as Record<string, unknown>);

  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-white/5 rounded"
        style={{ paddingLeft: depth * 16 }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown size={10} className="text-gray-600 flex-shrink-0" />
          : <ChevronRight size={10} className="text-gray-600 flex-shrink-0" />
        }
        {keyName !== undefined && (
          <span className="text-gray-400">{typeof keyName === 'number' ? `${keyName}:` : `"${keyName}":`}</span>
        )}
        <span className="text-gray-500">
          {openBracket}
          {!expanded && <span className="text-gray-600"> {entries.length} items {closeBracket}</span>}
        </span>
      </div>
      {expanded && (
        <>
          {entries.map(([key, val]) => {
            const childPath = computeJsonPath(path, key);
            return (
              <JsonNode
                key={String(key)}
                value={val}
                path={childPath}
                onSelectPath={onSelectPath}
                depth={depth + 1}
                keyName={key}
              />
            );
          })}
          <div style={{ paddingLeft: depth * 16 }} className="text-gray-500 py-0.5">
            {closeBracket}
          </div>
        </>
      )}
    </div>
  );
}
