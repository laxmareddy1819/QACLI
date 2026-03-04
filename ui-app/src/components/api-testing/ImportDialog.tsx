import { useState, useRef, useEffect } from 'react';
import { FileUp, X, ChevronRight, Check, Loader2, Wand2, FolderOpen, ChevronDown, AlertCircle } from 'lucide-react';
import { parseApiSpec, generateApiScenarios, importApiCollection } from '../../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../shared/Toast';
import type { ApiCollection, ApiRequest, ApiFolder } from '../../api/types';

type ImportStep = 'upload' | 'endpoints' | 'ai-generating' | 'preview' | 'confirm';

/** Robustly extract scenarios JSON from AI response text, handling various output formats */
function extractScenariosFromAIResponse(text: string): { scenarios: any[]; insights: string[] } | null {
  // Strategy 1: Look for <SCENARIOS_JSON> markers (case-insensitive, greedy)
  const markerMatch = text.match(/<SCENARIOS_JSON>([\s\S]+)<\/SCENARIOS_JSON>/i);
  if (markerMatch) {
    const parsed = tryParseJson(markerMatch[1].trim());
    if (parsed?.scenarios) return parsed;
  }

  // Strategy 2: Look for JSON inside markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlockMatches = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/g);
  if (codeBlockMatches) {
    // Try each code block, largest first (most likely to be the full JSON)
    const sorted = [...codeBlockMatches].sort((a, b) => b.length - a.length);
    for (const block of sorted) {
      const inner = block.replace(/```(?:json)?\s*\n?/, '').replace(/\n?```$/, '').trim();
      const parsed = tryParseJson(inner);
      if (parsed?.scenarios) return parsed;
    }
  }

  // Strategy 3: Find the largest JSON object `{...}` in the text via brace matching
  const jsonStr = extractLargestJsonObject(text);
  if (jsonStr) {
    const parsed = tryParseJson(jsonStr);
    if (parsed?.scenarios) return parsed;
  }

  // Strategy 4: Try parsing the whole text as JSON
  const wholeParsed = tryParseJson(text.trim());
  if (wholeParsed?.scenarios) return wholeParsed;

  return null;
}

function tryParseJson(str: string): any | null {
  try {
    return JSON.parse(str);
  } catch {
    // Try fixing common LLM JSON issues: trailing commas
    try {
      const fixed = str.replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

function extractLargestJsonObject(text: string): string | null {
  let bestStart = -1;
  let bestLen = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let j = i; j < text.length; j++) {
        const ch = text[j];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"' && !escape) { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const len = j - i + 1;
            if (len > bestLen) {
              bestStart = i;
              bestLen = len;
            }
            break;
          }
        }
      }
    }
  }

  return bestLen > 50 ? text.slice(bestStart, bestStart + bestLen) : null;
}

interface ParsedEndpoint {
  method: string;
  path: string;
  name?: string;
  summary?: string;
  folder?: string;
  tags?: string[];
  selected: boolean;
}

interface ImportDialogProps {
  onClose: () => void;
  existingCollections?: Array<{ name: string; requestCount: number }>;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-400',
  POST: 'bg-blue-500/15 text-blue-400',
  PUT: 'bg-amber-500/15 text-amber-400',
  PATCH: 'bg-brand-500/15 text-brand-400',
  DELETE: 'bg-red-500/15 text-red-400',
  HEAD: 'bg-purple-500/15 text-purple-400',
  OPTIONS: 'bg-gray-500/15 text-gray-400',
};

export function ImportDialog({ onClose, existingCollections = [] }: ImportDialogProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [pasteContent, setPasteContent] = useState('');
  const [detectedFormat, setDetectedFormat] = useState<string>('');
  const [specName, setSpecName] = useState('');
  const [endpoints, setEndpoints] = useState<ParsedEndpoint[]>([]);
  const [parsedCollection, setParsedCollection] = useState<ApiCollection | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [aiScenarios, setAiScenarios] = useState<Array<{ name: string; description: string; requests: ApiRequest[] }>>([]);
  const [aiInsights, setAiInsights] = useState<string[]>([]);
  const [collectionName, setCollectionName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Auto-detect format from pasted content
  const detectFormat = (text: string): string => {
    try {
      const parsed = JSON.parse(text);
      if (parsed.openapi) return 'openapi';
      if (parsed.swagger) return 'swagger';
      if (parsed.info && parsed.item) return 'postman';
      if (parsed.id && parsed.requests) return 'native';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setPasteContent(text);
    const fmt = detectFormat(text);
    setDetectedFormat(fmt);
    await handleParse(text, fmt);
  };

  const handleParse = async (content?: string, fmt?: string) => {
    const text = content || pasteContent;
    if (!text.trim()) { setError('Please provide spec content'); return; }

    const format = fmt || detectedFormat || detectFormat(text);
    setDetectedFormat(format);
    setLoading(true);
    setError('');

    try {
      const result = await parseApiSpec(text, format !== 'unknown' ? format : undefined);
      setDetectedFormat(result.format);
      setSpecName(result.specName);
      setCollectionName(result.specName);
      setParsedCollection(result.collection);
      setBaseUrl(result.collection.baseUrl || '');
      setEndpoints(result.endpoints.map(ep => ({
        ...ep,
        selected: true,
      })));
      setStep('endpoints');
    } catch (err) {
      setError(`Failed to parse: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = endpoints.filter(e => e.selected).length;

  const toggleEndpoint = (index: number) => {
    setEndpoints(prev => prev.map((ep, i) => i === index ? { ...ep, selected: !ep.selected } : ep));
  };

  const toggleAll = (selected: boolean) => {
    setEndpoints(prev => prev.map(ep => ({ ...ep, selected })));
  };

  const handleGenerateScenarios = async () => {
    setStep('ai-generating');
    setAiProgress('Analyzing API endpoints...');

    try {
      const selectedEps = endpoints.filter(e => e.selected);
      const requestId = `import-ai-${Date.now()}`;

      const result = await generateApiScenarios({
        requestId,
        endpoints: selectedEps,
        selectedEndpoints: selectedEps,
        specSummary: specName,
        existingCollections,
        baseUrl,
      });

      // Listen for WebSocket messages
      setAiProgress('AI is generating scenarios...');

      // Poll for completion via WebSocket messages
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      let fullText = '';

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.requestId !== requestId) return;

          if (msg.type === 'ai-fix-stream') {
            fullText += msg.content || '';
            setAiProgress(`AI is generating scenarios... (${fullText.length} chars)`);
          }

          if (msg.type === 'ai-fix-done') {
            ws.close();
            const extracted = extractScenariosFromAIResponse(fullText);
            if (extracted) {
              setAiScenarios(extracted.scenarios || []);
              setAiInsights(extracted.insights || []);
            } else if (fullText.length > 0) {
              console.warn('[ImportDialog] AI response could not be parsed. fullText length:', fullText.length);
              console.warn('[ImportDialog] First 500 chars:', fullText.slice(0, 500));
              console.warn('[ImportDialog] Last 500 chars:', fullText.slice(-500));
              setError('AI generated a response but could not parse scenarios JSON. Proceeding with original endpoints.');
            } else {
              console.warn('[ImportDialog] AI returned empty response (fullText is empty)');
              setError('AI returned an empty response. Proceeding with original endpoints.');
            }
            setStep('preview');
          }

          if (msg.type === 'ai-fix-error') {
            ws.close();
            setError(`AI generation failed: ${msg.error || 'Unknown error'}`);
            setStep('preview');
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => {
        setError('WebSocket connection failed. Proceeding with original endpoints.');
        setStep('preview');
      };

      // Timeout after 60 seconds
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
          if (step === 'ai-generating') {
            setStep('preview');
          }
        }
      }, 60000);

    } catch (err) {
      setError(`AI generation failed: ${err}`);
      setStep('preview');
    }
  };

  const handleProceedToPreview = () => {
    if (aiEnabled && selectedCount > 0) {
      handleGenerateScenarios();
    } else {
      setStep('preview');
    }
  };

  const buildFinalCollection = (): ApiCollection => {
    if (!parsedCollection) throw new Error('No parsed collection');

    const col = { ...parsedCollection };
    col.name = collectionName || specName || 'Imported API';
    col.baseUrl = baseUrl;

    // Filter to selected endpoints only
    const selectedPaths = new Set(endpoints.filter(e => e.selected).map(e => `${e.method}:${e.path}`));

    col.requests = col.requests.filter(r => selectedPaths.has(`${r.method}:${r.url}`) || selectedPaths.has(`${r.method}:${r.url.replace('{{baseUrl}}', '')}`));

    col.folders = col.folders.map(f => ({
      ...f,
      requests: f.requests.filter(r => selectedPaths.has(`${r.method}:${r.url}`) || selectedPaths.has(`${r.method}:${r.url.replace('{{baseUrl}}', '')}`)),
    })).filter(f => f.requests.length > 0);

    // Add AI scenarios as additional folders
    if (aiScenarios.length > 0) {
      for (const scenario of aiScenarios) {
        const folder: ApiFolder = {
          id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: `[AI] ${scenario.name}`,
          requests: scenario.requests.map((r, i) => {
            // Normalize body: LLM may use 'content' instead of 'raw'
            let body = r.body || { type: 'none' };
            if (body && typeof body === 'object' && 'content' in body && !(body as any).raw) {
              body = { ...body, raw: (body as any).content };
              delete (body as any).content;
            }
            // Safety net: normalize URL — add {{baseUrl}} prefix if missing
            let url = r.url || '';
            if (url && !url.startsWith('{{') && !url.startsWith('http')) {
              url = `{{baseUrl}}${url.startsWith('/') ? '' : '/'}${url}`;
            }
            return {
              ...r,
              id: r.id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`,
              name: r.name || `Step ${i + 1}`,
              url,
              headers: r.headers || [],
              queryParams: r.queryParams || [],
              body,
              auth: r.auth || { type: 'none' },
              validations: (r.validations || []).map((v: any, vi: number) => ({
                ...v,
                id: v.id || `vr-${Date.now()}-${vi}`,
                enabled: v.enabled !== false,
              })),
              preRequestScript: r.preRequestScript || undefined,
              postResponseScript: r.postResponseScript || undefined,
              followRedirects: r.followRedirects !== false,
              sortOrder: i,
            };
          }),
          sortOrder: col.folders.length,
        };
        col.folders.push(folder);
      }
    }

    // Auto-create Dev environment with baseUrl variable
    if (baseUrl) {
      col.environments = [{
        id: `env-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: 'Dev',
        variables: [{
          key: 'baseUrl',
          value: baseUrl,
          enabled: true,
          secret: false,
        }],
      }];
    }

    return col;
  };

  const handleImport = async () => {
    setLoading(true);
    try {
      const collection = buildFinalCollection();
      await importApiCollection(collection);

      // Auto-activate the Dev environment for this collection via localStorage
      if (collection.environments.length > 0) {
        try {
          localStorage.setItem(`qabot-active-env-${collection.id}`, collection.environments[0]!.id);
        } catch { /* ignore */ }
      }

      queryClient.invalidateQueries({ queryKey: ['api-collections'] });
      toast('success', `Collection "${collection.name}" imported with ${collection.folders.length} folders`);
      onClose();
    } catch (err) {
      setError(`Import failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleFolderExpand = (name: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  // Group endpoints by folder/tag for display
  const groupedEndpoints = endpoints.reduce((acc, ep, idx) => {
    const group = ep.folder || ep.tags?.[0] || 'Ungrouped';
    if (!acc.has(group)) acc.set(group, []);
    acc.get(group)!.push({ ...ep, originalIndex: idx });
    return acc;
  }, new Map<string, Array<ParsedEndpoint & { originalIndex: number }>>());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-1 border border-white/10 rounded-xl w-[750px] max-h-[85vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <FileUp size={16} className="text-brand-400" />
            <h2 className="text-sm font-bold text-gray-100">Import API Collection</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicator */}
            <div className="flex items-center gap-1 text-[11px] text-gray-500">
              {(['upload', 'endpoints', 'preview', 'confirm'] as ImportStep[]).map((s, i) => (
                <span key={s} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={8} className="text-gray-700" />}
                  <span className={step === s ? 'text-brand-400 font-bold' : (
                    ['upload', 'endpoints', 'ai-generating', 'preview', 'confirm'].indexOf(step) > ['upload', 'endpoints', 'preview', 'confirm'].indexOf(s)
                      ? 'text-emerald-400' : ''
                  )}>
                    {s === 'upload' ? 'Upload' : s === 'endpoints' ? 'Select' : s === 'preview' ? 'Preview' : 'Import'}
                  </span>
                </span>
              ))}
            </div>
            <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="px-5 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
            <p className="text-[13px] text-red-300 flex-1">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-300">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div>
                <label className="text-[13px] text-gray-400 block mb-2">Upload a file (.json)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-8 border-2 border-dashed border-white/10 rounded-xl hover:border-brand-500/30 transition-colors flex flex-col items-center gap-2"
                >
                  <FileUp size={24} className="text-gray-600" />
                  <span className="text-[13px] text-gray-500">Click to upload or drag & drop</span>
                  <span className="text-[11px] text-gray-600">Supports: OpenAPI 3.x, Swagger 2.x, Postman Collection v2.1</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-white/5" />
                <span className="text-[11px] text-gray-600 uppercase">or paste JSON</span>
                <div className="flex-1 border-t border-white/5" />
              </div>

              <textarea
                value={pasteContent}
                onChange={e => { setPasteContent(e.target.value); setDetectedFormat(detectFormat(e.target.value)); }}
                placeholder='{"openapi": "3.0.0", ...} or {"info": {"name": "..."}, "item": [...]}'
                className="w-full h-40 px-3 py-2 text-[13px] font-mono bg-surface-2 border border-white/5 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-500/50 resize-y"
              />

              {detectedFormat && detectedFormat !== 'unknown' && (
                <div className="flex items-center gap-2">
                  <Check size={12} className="text-emerald-400" />
                  <span className="text-[13px] text-emerald-400">
                    Detected: {detectedFormat === 'openapi' ? 'OpenAPI 3.x' : detectedFormat === 'swagger' ? 'Swagger 2.x' : detectedFormat === 'postman' ? 'Postman Collection' : 'Native Format'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Endpoint Picker */}
          {step === 'endpoints' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[13px] font-bold text-gray-200">{specName}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {selectedCount} of {endpoints.length} endpoints selected
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleAll(true)} className="text-[11px] text-brand-400 hover:text-brand-300">Select All</button>
                  <span className="text-gray-700">|</span>
                  <button onClick={() => toggleAll(false)} className="text-[11px] text-gray-500 hover:text-gray-300">Deselect All</button>
                </div>
              </div>

              <div className="border border-white/5 rounded-lg overflow-hidden max-h-[40vh] overflow-y-auto">
                {Array.from(groupedEndpoints.entries()).map(([group, eps]) => (
                  <div key={group}>
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-white/5 cursor-pointer"
                      onClick={() => toggleFolderExpand(group)}
                    >
                      {expandedFolders.has(group) || !expandedFolders.size
                        ? <ChevronDown size={11} className="text-gray-500" />
                        : <ChevronRight size={11} className="text-gray-500" />
                      }
                      <FolderOpen size={11} className="text-amber-500/60" />
                      <span className="text-xs text-gray-400 font-medium">{group}</span>
                      <span className="text-[11px] text-gray-600 ml-auto">{eps.filter(e => e.selected).length}/{eps.length}</span>
                    </div>
                    {(expandedFolders.has(group) || !expandedFolders.size) && eps.map(ep => (
                      <label
                        key={ep.originalIndex}
                        className="flex items-center gap-2 px-4 py-1.5 hover:bg-white/5 cursor-pointer border-b border-white/[2%]"
                      >
                        <input
                          type="checkbox"
                          checked={ep.selected}
                          onChange={() => toggleEndpoint(ep.originalIndex)}
                          className="w-3.5 h-3.5 rounded border-gray-600 bg-surface-2 accent-brand-500"
                        />
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${METHOD_COLORS[ep.method] || 'bg-gray-500/15 text-gray-400'}`}>
                          {ep.method}
                        </span>
                        <span className="text-xs text-gray-300 font-mono flex-1 truncate">{ep.path}</span>
                        {(ep.summary || ep.name) && (
                          <span className="text-[11px] text-gray-600 truncate max-w-[200px]">{ep.summary || ep.name}</span>
                        )}
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              {/* AI toggle */}
              <div className="flex items-center gap-3 p-3 bg-purple-500/5 border border-purple-500/15 rounded-lg">
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={aiEnabled}
                    onChange={e => setAiEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-surface-2 accent-purple-500"
                  />
                  <Wand2 size={14} className="text-purple-400" />
                  <div>
                    <span className="text-[13px] text-purple-300 font-medium">AI Generate Scenarios</span>
                    <p className="text-[11px] text-gray-500">Let AI analyze endpoints and create meaningful test flows</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Step 3: AI Generating */}
          {step === 'ai-generating' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-sm text-gray-200 font-medium">Generating Scenarios</p>
                <p className="text-[13px] text-gray-500 mt-1">{aiProgress}</p>
              </div>
            </div>
          )}

          {/* Step 4: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* AI insights */}
              {aiInsights.length > 0 && (
                <div className="p-3 bg-purple-500/5 border border-purple-500/15 rounded-lg">
                  <h4 className="text-[11px] text-purple-400 uppercase tracking-wider mb-1.5">AI Insights</h4>
                  <ul className="space-y-0.5">
                    {aiInsights.map((insight, i) => (
                      <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                        <span className="text-purple-400 mt-0.5">*</span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview tree */}
              <div className="border border-white/5 rounded-lg overflow-hidden max-h-[45vh] overflow-y-auto">
                {/* Original folders */}
                {parsedCollection?.folders.filter(f => f.requests.length > 0).map(folder => (
                  <div key={folder.id}>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-white/5">
                      <FolderOpen size={11} className="text-amber-500/60" />
                      <span className="text-xs text-gray-300 font-medium">{folder.name}</span>
                      <span className="text-[11px] text-gray-600 ml-auto">{folder.requests.length} requests</span>
                    </div>
                    {folder.requests.map(req => (
                      <div key={req.id} className="flex items-center gap-2 px-6 py-1 border-b border-white/[2%]">
                        <span className={`text-[11px] font-bold px-1 py-0.5 rounded ${METHOD_COLORS[req.method] || 'bg-gray-500/15 text-gray-400'}`}>
                          {req.method}
                        </span>
                        <span className="text-xs text-gray-400 truncate">{req.name || req.url}</span>
                      </div>
                    ))}
                  </div>
                ))}

                {/* AI scenario folders */}
                {aiScenarios.map((scenario, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/5 border-b border-purple-500/10">
                      <Wand2 size={11} className="text-purple-400" />
                      <span className="text-xs text-purple-300 font-medium">[AI] {scenario.name}</span>
                      <span className="text-[11px] text-gray-600 ml-auto">{scenario.requests.length} steps</span>
                    </div>
                    <p className="px-6 py-1 text-[11px] text-gray-600 border-b border-white/[2%]">{scenario.description}</p>
                    {scenario.requests.map((req, j) => (
                      <div key={j} className="flex items-center gap-2 px-6 py-1 border-b border-white/[2%]">
                        <span className="text-[11px] text-gray-600 w-4 text-right">{j + 1}.</span>
                        <span className={`text-[11px] font-bold px-1 py-0.5 rounded ${METHOD_COLORS[req.method] || 'bg-gray-500/15 text-gray-400'}`}>
                          {req.method}
                        </span>
                        <span className="text-xs text-gray-400 truncate">{req.name || req.url}</span>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Root requests */}
                {parsedCollection?.requests && parsedCollection.requests.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-white/5">
                      <span className="text-xs text-gray-400 font-medium">Root Requests</span>
                      <span className="text-[11px] text-gray-600 ml-auto">{parsedCollection.requests.length}</span>
                    </div>
                    {parsedCollection.requests.map(req => (
                      <div key={req.id} className="flex items-center gap-2 px-6 py-1 border-b border-white/[2%]">
                        <span className={`text-[11px] font-bold px-1 py-0.5 rounded ${METHOD_COLORS[req.method] || 'bg-gray-500/15 text-gray-400'}`}>
                          {req.method}
                        </span>
                        <span className="text-xs text-gray-400 truncate">{req.name || req.url}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 5: Confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-wider">Collection Name</label>
                <input
                  value={collectionName}
                  onChange={e => setCollectionName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm bg-surface-2 border border-white/5 rounded-lg text-gray-200 focus:outline-none focus:border-brand-500/50"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-wider">Base URL</label>
                <input
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full mt-1 px-3 py-2 text-sm font-mono bg-surface-2 border border-white/5 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
                />
              </div>
              <div className="p-3 bg-surface-2 rounded-lg border border-white/5 space-y-1">
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-500">Endpoints</span>
                  <span className="text-gray-300">{selectedCount}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-500">Folders</span>
                  <span className="text-gray-300">{parsedCollection ? parsedCollection.folders.length + aiScenarios.length : 0}</span>
                </div>
                {aiScenarios.length > 0 && (
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-500">AI Scenarios</span>
                    <span className="text-purple-300">{aiScenarios.length}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
          <button
            onClick={() => {
              if (step === 'upload') onClose();
              else if (step === 'endpoints') setStep('upload');
              else if (step === 'preview') setStep('endpoints');
              else if (step === 'confirm') setStep('preview');
            }}
            className="px-4 py-1.5 rounded-lg text-[13px] text-gray-400 hover:text-gray-200 transition-colors"
          >
            {step === 'upload' ? 'Cancel' : 'Back'}
          </button>

          <button
            onClick={() => {
              if (step === 'upload') handleParse();
              else if (step === 'endpoints') handleProceedToPreview();
              else if (step === 'preview') setStep('confirm');
              else if (step === 'confirm') handleImport();
            }}
            disabled={
              loading
              || (step === 'upload' && !pasteContent.trim())
              || (step === 'endpoints' && selectedCount === 0)
            }
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-500 text-white text-[13px] font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            {step === 'upload' ? 'Parse' :
             step === 'endpoints' ? (aiEnabled ? 'Generate & Preview' : 'Preview') :
             step === 'preview' ? 'Continue' :
             'Import Collection'}
          </button>
        </div>
      </div>
    </div>
  );
}
