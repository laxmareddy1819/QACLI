import { useState } from 'react';
import {
  FolderOpen, FolderClosed, Plus, Trash2, ChevronDown, ChevronRight,
  FileUp, MoreHorizontal, Play, Pencil,
} from 'lucide-react';
import type { ApiCollection, ApiCollectionSummary, ApiRequest, ApiFolder, HttpMethod } from '../../api/types';
import { useCreateCollection, useDeleteCollection, useUpdateCollection, useCreateFolder, useDeleteFolder, useDeleteRequest } from '../../hooks/useApiTesting';
import { updateApiFolder } from '../../api/client';
import { useToast } from '../shared/Toast';

interface CollectionTreeProps {
  collections: ApiCollectionSummary[];
  selectedCollection: ApiCollection | null;
  selectedRequestId: string | null;
  onSelectCollection: (id: string) => void;
  onSelectRequest: (req: ApiRequest, folderId?: string) => void;
  onImport?: () => void;
  onRunChain?: (folder: ApiFolder) => void;
}

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-blue-400',
  PUT: 'text-amber-400',
  PATCH: 'text-brand-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-gray-400',
};

export function CollectionTree({
  collections, selectedCollection, selectedRequestId,
  onSelectCollection, onSelectRequest, onImport, onRunChain,
}: CollectionTreeProps) {
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newFolderColId, setNewFolderColId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editCollectionName, setEditCollectionName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');

  const { toast } = useToast();
  const createCol = useCreateCollection();
  const deleteCol = useDeleteCollection();
  const updateCol = useUpdateCollection();
  const createFld = useCreateFolder();
  const deleteFld = useDeleteFolder();
  const deleteReq = useDeleteRequest();

  const toggleCollection = (id: string) => {
    const next = new Set(expandedCollections);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedCollections(next);
    onSelectCollection(id);
  };

  const toggleFolder = (id: string) => {
    const next = new Set(expandedFolders);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedFolders(next);
  };

  const handleCreateCollection = () => {
    if (!newCollectionName.trim()) return;
    createCol.mutate({ name: newCollectionName.trim() }, {
      onSuccess: () => { setShowNewCollection(false); setNewCollectionName(''); toast('success', 'Collection created'); },
      onError: (e) => toast('error', String(e)),
    });
  };

  const handleCreateFolder = (colId: string) => {
    if (!newFolderName.trim()) return;
    createFld.mutate({ collectionId: colId, name: newFolderName.trim() }, {
      onSuccess: () => { setNewFolderColId(null); setNewFolderName(''); toast('success', 'Folder created'); },
      onError: (e) => toast('error', String(e)),
    });
  };

  const startEditCollection = (id: string, name: string) => {
    setEditingCollectionId(id);
    setEditCollectionName(name);
  };

  const handleRenameCollection = (id: string) => {
    if (!editCollectionName.trim()) { setEditingCollectionId(null); return; }
    updateCol.mutate({ id, data: { name: editCollectionName.trim() } }, {
      onSuccess: () => { setEditingCollectionId(null); toast('success', 'Collection renamed'); },
      onError: (e) => { toast('error', String(e)); },
    });
  };

  const startEditFolder = (folderId: string, name: string) => {
    setEditingFolderId(folderId);
    setEditFolderName(name);
  };

  const handleRenameFolder = async (colId: string, folderId: string) => {
    if (!editFolderName.trim()) { setEditingFolderId(null); return; }
    try {
      await updateApiFolder(colId, folderId, { name: editFolderName.trim() });
      setEditingFolderId(null);
      toast('success', 'Folder renamed');
      onSelectCollection(colId); // refresh
    } catch (e) {
      toast('error', String(e));
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-shrink-0">
        <span className="text-[11px] font-semibold uppercase text-gray-500 tracking-wider">Collections</span>
        <div className="flex gap-1">
          {onImport && (
            <button onClick={onImport} className="p-1 text-gray-500 hover:text-gray-300" title="Import">
              <FileUp size={13} />
            </button>
          )}
          <button onClick={() => setShowNewCollection(true)} className="p-1 text-gray-500 hover:text-gray-300" title="New Collection">
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* New collection input */}
      {showNewCollection && (
        <div className="px-3 py-2 border-b border-white/5">
          <input
            autoFocus
            value={newCollectionName}
            onChange={e => setNewCollectionName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateCollection(); if (e.key === 'Escape') setShowNewCollection(false); }}
            placeholder="Collection name"
            className="w-full px-2 py-1 text-[13px] bg-surface-2 border border-brand-500/30 rounded text-gray-200 placeholder-gray-600 focus:outline-none"
          />
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {collections.length === 0 && !showNewCollection && (
          <div className="px-3 py-6 text-center">
            <p className="text-[13px] text-gray-600">No collections yet</p>
            <button onClick={() => setShowNewCollection(true)} className="text-xs text-brand-400 hover:text-brand-300 mt-1">
              Create one
            </button>
          </div>
        )}

        {collections.map(col => {
          const isExpanded = expandedCollections.has(col.id);
          const isSelected = selectedCollection?.id === col.id;

          return (
            <div key={col.id}>
              {/* Collection header */}
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-white/5 group ${
                  isSelected ? 'bg-brand-500/10' : ''
                }`}
                onClick={() => toggleCollection(col.id)}
              >
                {isExpanded ? <ChevronDown size={12} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={12} className="text-gray-500 flex-shrink-0" />}
                {isExpanded ? <FolderOpen size={13} className="text-brand-400 flex-shrink-0" /> : <FolderClosed size={13} className="text-gray-400 flex-shrink-0" />}
                {editingCollectionId === col.id ? (
                  <input
                    autoFocus
                    value={editCollectionName}
                    onChange={e => setEditCollectionName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenameCollection(col.id); if (e.key === 'Escape') setEditingCollectionId(null); }}
                    onBlur={() => handleRenameCollection(col.id)}
                    onClick={e => e.stopPropagation()}
                    className="flex-1 px-1.5 py-0 text-[13px] bg-surface-2 border border-brand-500/30 rounded text-gray-200 focus:outline-none min-w-0"
                  />
                ) : (
                  <span
                    className="text-[13px] text-gray-300 truncate flex-1"
                    onDoubleClick={e => { e.stopPropagation(); startEditCollection(col.id, col.name); }}
                  >
                    {col.name}
                  </span>
                )}
                <span className="text-[11px] text-gray-600 flex-shrink-0">{col.requestCount}</span>
                <button
                  onClick={e => { e.stopPropagation(); startEditCollection(col.id, col.name); }}
                  className="p-0.5 text-gray-600 hover:text-brand-300 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  title="Rename"
                >
                  <Pencil size={10} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); deleteCol.mutate(col.id); }}
                  className="p-0.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                >
                  <Trash2 size={11} />
                </button>
              </div>

              {/* Expanded collection content */}
              {isExpanded && isSelected && selectedCollection && (
                <div className="ml-3">
                  {/* Folders */}
                  {selectedCollection.folders.map(folder => {
                    const isFolderExpanded = expandedFolders.has(folder.id);
                    return (
                      <div key={folder.id}>
                        <div
                          className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-white/5 group"
                          onClick={() => toggleFolder(folder.id)}
                        >
                          {isFolderExpanded ? <ChevronDown size={11} className="text-gray-600" /> : <ChevronRight size={11} className="text-gray-600" />}
                          <FolderClosed size={12} className="text-amber-500/60" />
                          {editingFolderId === folder.id ? (
                            <input
                              autoFocus
                              value={editFolderName}
                              onChange={e => setEditFolderName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(col.id, folder.id); if (e.key === 'Escape') setEditingFolderId(null); }}
                              onBlur={() => handleRenameFolder(col.id, folder.id)}
                              onClick={e => e.stopPropagation()}
                              className="flex-1 px-1.5 py-0 text-xs bg-surface-2 border border-brand-500/30 rounded text-gray-200 focus:outline-none min-w-0"
                            />
                          ) : (
                            <span
                              className="text-xs text-gray-400 truncate flex-1"
                              onDoubleClick={e => { e.stopPropagation(); startEditFolder(folder.id, folder.name); }}
                            >
                              {folder.name}
                            </span>
                          )}
                          {onRunChain && (
                            <button
                              onClick={e => { e.stopPropagation(); if (folder.requests.length > 0) onRunChain(folder); }}
                              disabled={folder.requests.length === 0}
                              className={`p-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 ${
                                folder.requests.length > 0
                                  ? 'text-gray-600 hover:text-emerald-400'
                                  : 'text-gray-700 cursor-not-allowed'
                              }`}
                              title={folder.requests.length > 0 ? 'Run as chain' : 'Add requests to run as chain'}
                            >
                              <Play size={10} />
                            </button>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); startEditFolder(folder.id, folder.name); }}
                            className="p-0.5 text-gray-600 hover:text-brand-300 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                            title="Rename"
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); deleteFld.mutate({ collectionId: col.id, folderId: folder.id }); }}
                            className="p-0.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                        {isFolderExpanded && (
                          <>
                            {folder.requests.map(req => (
                              <RequestItem
                                key={req.id}
                                request={req}
                                selected={selectedRequestId === req.id}
                                onSelect={() => onSelectRequest(req, folder.id)}
                                onDelete={() => deleteReq.mutate({ collectionId: col.id, requestId: req.id })}
                                indent={2}
                              />
                            ))}
                            <div style={{ paddingLeft: '36px', paddingRight: '12px' }} className="py-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newReq: ApiRequest = {
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
                                    sortOrder: folder.requests.length,
                                  };
                                  onSelectRequest(newReq, folder.id);
                                }}
                                className="text-[11px] text-gray-600 hover:text-gray-400"
                              >
                                + Request
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Root requests */}
                  {selectedCollection.requests.map(req => (
                    <RequestItem
                      key={req.id}
                      request={req}
                      selected={selectedRequestId === req.id}
                      onSelect={() => onSelectRequest(req)}
                      onDelete={() => deleteReq.mutate({ collectionId: col.id, requestId: req.id })}
                      indent={1}
                    />
                  ))}

                  {/* Add folder / request buttons */}
                  {newFolderColId === col.id ? (
                    <div className="px-5 py-1">
                      <input
                        autoFocus
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(col.id); if (e.key === 'Escape') setNewFolderColId(null); }}
                        placeholder="Folder name"
                        className="w-full px-2 py-0.5 text-xs bg-surface-2 border border-brand-500/30 rounded text-gray-200 placeholder-gray-600 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <div className="flex gap-2 px-5 py-1">
                      <button
                        onClick={() => setNewFolderColId(col.id)}
                        className="text-[11px] text-gray-600 hover:text-gray-400"
                      >
                        + Folder
                      </button>
                      <button
                        onClick={() => {
                          const newReq: ApiRequest = {
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
                          onSelectRequest(newReq);
                        }}
                        className="text-[11px] text-gray-600 hover:text-gray-400"
                      >
                        + Request
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RequestItem({ request, selected, onSelect, onDelete, indent }: {
  request: ApiRequest; selected: boolean; onSelect: () => void; onDelete: () => void; indent: number;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 py-1 cursor-pointer hover:bg-white/5 group ${
        selected ? 'bg-brand-500/10' : ''
      }`}
      style={{ paddingLeft: `${indent * 12 + 12}px`, paddingRight: '12px' }}
      onClick={onSelect}
    >
      <span className={`text-[11px] font-bold w-8 flex-shrink-0 ${METHOD_COLORS[request.method]}`}>
        {request.method.slice(0, 3)}
      </span>
      <span className="text-xs text-gray-400 truncate flex-1">
        {request.name || request.url || 'Untitled'}
      </span>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="p-0.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}
