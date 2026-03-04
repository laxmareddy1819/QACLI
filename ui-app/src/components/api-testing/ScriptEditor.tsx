import { useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle, Plus } from 'lucide-react';

interface ScriptEditorProps {
  preRequestScript?: string;
  postResponseScript?: string;
  onChangePreRequest: (script: string) => void;
  onChangePostResponse: (script: string) => void;
}

export function ScriptEditor({
  preRequestScript = '', postResponseScript = '',
  onChangePreRequest, onChangePostResponse,
}: ScriptEditorProps) {
  const [expandPre, setExpandPre] = useState(!!preRequestScript);
  const [expandPost, setExpandPost] = useState(!!postResponseScript);
  const [showHelp, setShowHelp] = useState(false);
  const [quickVarName, setQuickVarName] = useState('');
  const [quickJsonPath, setQuickJsonPath] = useState('');

  const addQuickExtract = () => {
    if (!quickVarName.trim() || !quickJsonPath.trim()) return;
    const line = `set("${quickVarName.trim()}", jsonpath(response.body, "${quickJsonPath.trim()}"))`;
    const updated = postResponseScript ? `${postResponseScript}\n${line}` : line;
    onChangePostResponse(updated);
    setQuickVarName('');
    setQuickJsonPath('');
    setExpandPost(true);
  };

  return (
    <div className="space-y-3">
      {/* Quick Extract shortcut */}
      <div className="p-3 bg-surface-2 rounded-lg border border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Quick Extract Variable</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={quickVarName}
            onChange={e => setQuickVarName(e.target.value)}
            placeholder="Variable name"
            className="w-28 px-2 py-1 text-[11px] bg-surface-1 border border-white/5 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
          />
          <span className="text-[11px] text-gray-600">=</span>
          <input
            value={quickJsonPath}
            onChange={e => setQuickJsonPath(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addQuickExtract(); }}
            placeholder="$.data.token"
            className="flex-1 px-2 py-1 text-[11px] font-mono bg-surface-1 border border-white/5 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
          />
          <button
            onClick={addQuickExtract}
            disabled={!quickVarName.trim() || !quickJsonPath.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-brand-500 text-white text-[11px] font-medium hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={10} /> Add
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-1.5">
          Tip: Use the Extract Variable feature in the Response panel to auto-fill the JSONPath
        </p>
      </div>

      {/* Pre-Request Script */}
      <div className="rounded-lg border border-white/5 overflow-hidden">
        <button
          onClick={() => setExpandPre(!expandPre)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-3 transition-colors text-left"
        >
          {expandPre ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
          <span className="text-[11px] font-medium text-gray-300">Pre-Request Script</span>
          {preRequestScript && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-300 ml-auto">active</span>}
        </button>
        {expandPre && (
          <textarea
            value={preRequestScript}
            onChange={e => onChangePreRequest(e.target.value)}
            placeholder="// Runs before the request is sent&#10;// Example: setHeader('Authorization', 'Bearer ' + get('token'))"
            className="w-full h-32 px-3 py-2 text-[11px] font-mono bg-surface-1 text-gray-300 placeholder-gray-600 border-t border-white/5 resize-y focus:outline-none"
          />
        )}
      </div>

      {/* Post-Response Script */}
      <div className="rounded-lg border border-white/5 overflow-hidden">
        <button
          onClick={() => setExpandPost(!expandPost)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-3 transition-colors text-left"
        >
          {expandPost ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
          <span className="text-[11px] font-medium text-gray-300">Post-Response Script</span>
          {postResponseScript && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-300 ml-auto">active</span>}
        </button>
        {expandPost && (
          <textarea
            value={postResponseScript}
            onChange={e => onChangePostResponse(e.target.value)}
            placeholder="// Runs after the response is received&#10;// Example: set('userId', jsonpath(response.body, '$.data.id'))"
            className="w-full h-32 px-3 py-2 text-[11px] font-mono bg-surface-1 text-gray-300 placeholder-gray-600 border-t border-white/5 resize-y focus:outline-none"
          />
        )}
      </div>

      {/* Help panel */}
      <div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          <HelpCircle size={11} /> Script DSL Reference
        </button>
        {showHelp && (
          <div className="mt-2 p-3 bg-surface-2 rounded-lg border border-white/5 space-y-2">
            <div>
              <code className="text-[11px] text-brand-300">get(key)</code>
              <span className="text-[10px] text-gray-500 ml-2">Read a chain variable</span>
            </div>
            <div>
              <code className="text-[11px] text-brand-300">set(key, value)</code>
              <span className="text-[10px] text-gray-500 ml-2">Store a chain variable for subsequent requests</span>
            </div>
            <div>
              <code className="text-[11px] text-brand-300">jsonpath(body, path)</code>
              <span className="text-[10px] text-gray-500 ml-2">Extract value from JSON body using path like $.data.id</span>
            </div>
            <div>
              <code className="text-[11px] text-brand-300">setHeader(name, value)</code>
              <span className="text-[10px] text-gray-500 ml-2">Set/override a header for the current request (pre-request only)</span>
            </div>
            <hr className="border-white/5" />
            <p className="text-[10px] text-gray-600">
              Example: Extract a token from login response and use it in the next request:
            </p>
            <code className="block text-[10px] text-gray-400 font-mono bg-surface-1 p-2 rounded">
              {`// Post-Response Script (on login request):\nset("token", jsonpath(response.body, "$.access_token"))\n\n// Pre-Request Script (on next request):\nsetHeader("Authorization", "Bearer " + get("token"))`}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}
