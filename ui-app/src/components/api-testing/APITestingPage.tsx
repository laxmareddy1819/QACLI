import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Send, Globe, Clock, Settings2, ChevronDown, Check, XCircle, Wand2 } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { useApiCollections, useApiCollection, useSaveRequest, useSendRequest } from '../../hooks/useApiTesting';
import { useToast } from '../shared/Toast';
import { CollectionTree } from './CollectionTree';
import { RequestBuilder } from './RequestBuilder';
import { ResponseViewer } from './ResponseViewer';
import { EnvironmentEditor } from './EnvironmentEditor';
import { HistoryPanel } from './HistoryPanel';
import { GenerateTestDialog } from './GenerateTestDialog';
import { ChainRunner } from './ChainRunner';
import { QuickValidationPicker } from './QuickValidationPicker';
import { ImportDialog } from './ImportDialog';
import type { ApiRequest, ApiResponse, ApiCollection, ApiFolder, ValidationRule, WSMessage } from '../../api/types';
import { saveApiEnvironment, updateApiEnvironment, deleteApiEnvironment } from '../../api/client';
import { useQueryClient } from '@tanstack/react-query';

// ── localStorage helpers for persisting active env per collection ──
function getPersistedEnvId(collectionId: string | null): string | null {
  if (!collectionId) return null;
  try { return localStorage.getItem(`qabot-active-env-${collectionId}`); } catch { return null; }
}
function persistEnvId(collectionId: string | null, envId: string | null): void {
  if (!collectionId) return;
  try {
    if (envId) localStorage.setItem(`qabot-active-env-${collectionId}`, envId);
    else localStorage.removeItem(`qabot-active-env-${collectionId}`);
  } catch { /* ignore */ }
}

function createEmptyRequest(): ApiRequest {
  return {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: 'New Request',
    method: 'GET',
    url: '',
    headers: [],
    queryParams: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    validations: [],
    followRedirects: true,
    sortOrder: 0,
  };
}

export function APITestingPage() {
  const { subscribe, send } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    send: (msg: object) => void;
  }>();

  const { data: collectionsData } = useApiCollections();
  const collections = collectionsData?.collections || [];

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const { data: selectedCollection } = useApiCollection(selectedCollectionId);

  const [currentRequest, setCurrentRequest] = useState<ApiRequest>(createEmptyRequest);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<ApiResponse | null>(null);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showGenerateTest, setShowGenerateTest] = useState(false);
  const [chainFolder, setChainFolder] = useState<ApiFolder | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showEnvDropdown, setShowEnvDropdown] = useState(false);
  const envDropdownRef = useRef<HTMLDivElement>(null);

  // Resizable panel widths
  const [leftWidth, setLeftWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(400);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const saveReq = useSaveRequest();
  const sendReq = useSendRequest();

  // Fix 1 & 5: Persist active env per collection + restore on collection switch
  useEffect(() => {
    if (!selectedCollectionId) { setActiveEnvId(null); return; }
    const saved = getPersistedEnvId(selectedCollectionId);
    if (saved && selectedCollection?.environments.some(e => e.id === saved)) {
      setActiveEnvId(saved);
    } else {
      setActiveEnvId(null);
    }
  }, [selectedCollectionId, selectedCollection?.environments]);

  const handleSetActiveEnv = useCallback((envId: string | null) => {
    setActiveEnvId(envId);
    persistEnvId(selectedCollectionId, envId);
  }, [selectedCollectionId]);

  // Close env dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envDropdownRef.current && !envDropdownRef.current.contains(e.target as Node)) {
        setShowEnvDropdown(false);
      }
    };
    if (showEnvDropdown) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEnvDropdown]);

  // Resizable left panel handler
  const handleLeftMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLeft(true);
    const startX = e.clientX;
    const startWidth = leftWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(450, startWidth + e.clientX - startX));
      setLeftWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [leftWidth]);

  // Resizable right panel handler
  const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRight(true);
    const startX = e.clientX;
    const startWidth = rightWidth;

    const handleMouseMove = (e: MouseEvent) => {
      // Right panel: dragging left increases width, dragging right decreases
      const newWidth = Math.max(280, Math.min(650, startWidth - (e.clientX - startX)));
      setRightWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [rightWidth]);

  // Memoize current variables for passing to RequestBuilder
  const currentVariables = useMemo(() => {
    if (!selectedCollection || !activeEnvId) return {};
    const env = selectedCollection.environments.find(e => e.id === activeEnvId);
    if (!env) return {};
    const vars: Record<string, string> = {};
    for (const v of env.variables) {
      if (v.enabled) vars[v.key] = v.value;
    }
    // Collection baseUrl is only a fallback — env variable takes priority
    if (selectedCollection.baseUrl && !vars['baseUrl']) {
      vars['baseUrl'] = selectedCollection.baseUrl;
    }
    return vars;
  }, [selectedCollection, activeEnvId]);

  // Build variables from active environment (uses memoized value)
  const getVariables = useCallback((): Record<string, string> => {
    return currentVariables;
  }, [currentVariables]);

  const handleSelectRequest = (req: ApiRequest, folderId?: string) => {
    setCurrentRequest(req);
    setSelectedRequestId(req.id);
    setSelectedFolderId(folderId || null);
    setLastResponse(null);
  };

  const handleSaveRequest = () => {
    if (!selectedCollectionId) return;
    saveReq.mutate({
      collectionId: selectedCollectionId,
      request: currentRequest,
      folderId: selectedFolderId || undefined,
    });
  };

  const handleSend = async () => {
    if (!currentRequest.url) {
      toast('error', 'Please enter a URL');
      return;
    }

    const variables = getVariables();
    sendReq.mutate(
      { request: currentRequest, variables, collectionId: selectedCollectionId || undefined },
      {
        onSuccess: (response) => {
          setLastResponse(response);
          // Auto-save request to collection if we have one
          if (selectedCollectionId) {
            saveReq.mutate({
              collectionId: selectedCollectionId,
              request: currentRequest,
              folderId: selectedFolderId || undefined,
            });
          }
        },
        onError: (err) => {
          toast('error', `Request failed: ${err}`);
        },
      },
    );
  };

  const [showQuickValidate, setShowQuickValidate] = useState(false);

  const handleAddValidation = (rule: ValidationRule) => {
    setCurrentRequest(prev => ({
      ...prev,
      validations: [...prev.validations, rule],
    }));
    toast('success', 'Validation added');
  };

  const handleExtractVariable = (name: string, path: string) => {
    const line = `set("${name}", jsonpath(response.body, "${path}"))`;
    setCurrentRequest(prev => ({
      ...prev,
      postResponseScript: prev.postResponseScript
        ? `${prev.postResponseScript}\n${line}`
        : line,
    }));
    toast('success', `Variable "${name}" extraction added to post-response script`);
  };

  const handleSaveEnv = async (env: import('../../api/types').ApiEnvironment) => {
    if (!selectedCollectionId) return;
    try {
      const isExisting = selectedCollection?.environments.some(e => e.id === env.id);
      if (isExisting) {
        await updateApiEnvironment(selectedCollectionId, env.id, env);
      } else {
        await saveApiEnvironment(selectedCollectionId, env);
      }
      queryClient.invalidateQueries({ queryKey: ['api-collection', selectedCollectionId] });
      toast('success', 'Environment saved');
    } catch (e) {
      toast('error', String(e));
    }
  };

  const handleDeleteEnv = async (envId: string) => {
    if (!selectedCollectionId) return;
    try {
      await deleteApiEnvironment(selectedCollectionId, envId);
      if (activeEnvId === envId) handleSetActiveEnv(null);
      queryClient.invalidateQueries({ queryKey: ['api-collection', selectedCollectionId] });
    } catch (e) {
      toast('error', String(e));
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Send size={22} className="text-brand-400" />
            <h1 className="text-2xl font-bold text-gray-100">API Testing</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Environment quick-switch dropdown */}
            {selectedCollectionId && selectedCollection && (
              <div className="relative" ref={envDropdownRef}>
                <button
                  onClick={() => setShowEnvDropdown(prev => !prev)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm transition-colors ${
                    activeEnvId
                      ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                      : 'bg-surface-2 text-gray-400 hover:bg-surface-3 hover:text-gray-300'
                  }`}
                >
                  <Globe size={12} />
                  {activeEnvId
                    ? selectedCollection.environments.find(e => e.id === activeEnvId)?.name || 'Environment'
                    : 'No Environment'}
                  <ChevronDown size={10} className={`transition-transform ${showEnvDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showEnvDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-surface-1 border border-white/10 rounded-lg z-50 py-1 animate-fade-in">
                    {/* No Environment option */}
                    <button
                      onClick={() => { handleSetActiveEnv(null); setShowEnvDropdown(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 transition-colors ${
                        !activeEnvId ? 'text-gray-200' : 'text-gray-500'
                      }`}
                    >
                      <span className="w-3.5 flex items-center justify-center">
                        {!activeEnvId && <Check size={11} className="text-emerald-400" />}
                      </span>
                      <XCircle size={11} className="text-gray-600" />
                      No Environment
                    </button>

                    {selectedCollection.environments.length > 0 && (
                      <div className="border-t border-white/5 my-1" />
                    )}

                    {/* Environment list */}
                    {selectedCollection.environments.map(env => (
                      <button
                        key={env.id}
                        onClick={() => { handleSetActiveEnv(env.id); setShowEnvDropdown(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 transition-colors ${
                          activeEnvId === env.id ? 'text-emerald-400' : 'text-gray-300'
                        }`}
                      >
                        <span className="w-3.5 flex items-center justify-center">
                          {activeEnvId === env.id && <Check size={11} className="text-emerald-400" />}
                        </span>
                        <Globe size={11} className={activeEnvId === env.id ? 'text-emerald-400' : 'text-gray-600'} />
                        <span className="truncate">{env.name}</span>
                        <span className="ml-auto text-[10px] text-gray-600">{env.variables.filter(v => v.enabled).length} vars</span>
                      </button>
                    ))}

                    {/* Manage button */}
                    <div className="border-t border-white/5 mt-1 pt-1">
                      <button
                        onClick={() => { setShowEnvEditor(true); setShowEnvDropdown(false); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                      >
                        <span className="w-3.5" />
                        <Settings2 size={11} />
                        Manage Environments...
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Generate Test button */}
            <button
              onClick={() => setShowGenerateTest(true)}
              disabled={!selectedCollectionId}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm transition-colors ${
                selectedCollectionId
                  ? 'bg-purple-500/15 text-purple-300 hover:bg-purple-500/25'
                  : 'bg-surface-2 text-gray-600 cursor-not-allowed'
              }`}
            >
              <Wand2 size={12} /> Generate Test
            </button>

            {/* History toggle */}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm transition-colors ${
                showHistory
                  ? 'bg-brand-500/15 text-brand-300'
                  : 'bg-surface-2 text-gray-400 hover:bg-surface-3 hover:text-gray-300'
              }`}
            >
              <Clock size={12} /> History
            </button>
          </div>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Collection tree */}
        <div
          className="flex-shrink-0 overflow-hidden bg-surface-1"
          style={{ width: `${leftWidth}px` }}
        >
          <CollectionTree
            collections={collections}
            selectedCollection={selectedCollection || null}
            selectedRequestId={selectedRequestId}
            onSelectCollection={setSelectedCollectionId}
            onSelectRequest={handleSelectRequest}
            onImport={() => setShowImportDialog(true)}
            onRunChain={(folder) => setChainFolder(folder)}
          />
        </div>

        {/* Left resize handle */}
        <div
          className={`w-1 cursor-col-resize hover:bg-brand-500/30 transition-colors flex-shrink-0 ${
            isResizingLeft ? 'bg-brand-500/40' : ''
          }`}
          onMouseDown={handleLeftMouseDown}
        />

        {/* Center: Request builder */}
        <div className="flex-1 flex flex-col overflow-hidden bg-surface-1">
          <RequestBuilder
            request={currentRequest}
            onChange={setCurrentRequest}
            onSend={handleSend}
            onSave={handleSaveRequest}
            onQuickValidate={lastResponse ? () => setShowQuickValidate(true) : undefined}
            sending={sendReq.isPending}
            validationResults={lastResponse?.validationResults}
            variables={currentVariables}
          />
        </div>

        {/* Right resize handle */}
        <div
          className={`w-1 cursor-col-resize hover:bg-brand-500/30 transition-colors flex-shrink-0 ${
            isResizingRight ? 'bg-brand-500/40' : ''
          }`}
          onMouseDown={handleRightMouseDown}
        />

        {/* Right: Response viewer or History */}
        <div
          className="flex-shrink-0 overflow-hidden bg-surface-1"
          style={{ width: `${rightWidth}px` }}
        >
          {showHistory ? (
            <HistoryPanel
              onSelectRequest={handleSelectRequest}
              onClose={() => setShowHistory(false)}
            />
          ) : (
            <ResponseViewer
              response={lastResponse}
              loading={sendReq.isPending}
              onAddValidation={handleAddValidation}
              onExtractVariable={handleExtractVariable}
            />
          )}
        </div>
      </div>

      {/* Environment editor modal */}
      {showEnvEditor && selectedCollection && (
        <EnvironmentEditor
          environments={selectedCollection.environments}
          activeEnvId={activeEnvId}
          onSelectEnv={handleSetActiveEnv}
          onSave={handleSaveEnv}
          onDelete={handleDeleteEnv}
          onClose={() => setShowEnvEditor(false)}
        />
      )}

      {/* Generate Test dialog */}
      {showGenerateTest && selectedCollection && (
        <GenerateTestDialog
          collection={selectedCollection}
          currentRequest={currentRequest}
          lastResponse={lastResponse}
          subscribe={subscribe}
          send={send}
          onClose={() => setShowGenerateTest(false)}
        />
      )}

      {/* Chain Runner */}
      {chainFolder && (
        <ChainRunner
          folder={chainFolder}
          variables={getVariables()}
          onClose={() => setChainFolder(null)}
        />
      )}

      {/* Quick Validation Picker */}
      {showQuickValidate && lastResponse && (
        <QuickValidationPicker
          responseBody={lastResponse.body}
          onAddValidation={(rule) => { handleAddValidation(rule); }}
          onClose={() => setShowQuickValidate(false)}
        />
      )}

      {/* Import Dialog */}
      {showImportDialog && (
        <ImportDialog
          onClose={() => setShowImportDialog(false)}
          existingCollections={collections.map(c => ({ name: c.name, requestCount: c.requestCount }))}
        />
      )}
    </div>
  );
}
