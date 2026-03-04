import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir } from '../../utils/index.js';
import type {
  ApiCollection, ApiRequest, ApiFolder, ApiEnvironment,
  ApiHistoryEntry, ApiCollectionsData, ApiResponse,
} from '../types/api-testing.js';

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_COLLECTIONS = 50;
const MAX_HISTORY = 200;

// ── Store ───────────────────────────────────────────────────────────────────

export class ApiCollectionsStore {
  private data: ApiCollectionsData = { collections: [], history: [] };
  private filePath: string;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'api-collections.json');
    this.load();
  }

  // ── Collection CRUD ─────────────────────────────────────────────────────

  getCollections(): ApiCollection[] {
    return this.data.collections;
  }

  getCollection(id: string): ApiCollection | undefined {
    return this.data.collections.find(c => c.id === id);
  }

  createCollection(collection: ApiCollection): ApiCollection {
    if (this.data.collections.length >= MAX_COLLECTIONS) {
      throw new Error(`Maximum of ${MAX_COLLECTIONS} collections reached`);
    }
    const now = new Date().toISOString();
    const col: ApiCollection = {
      ...collection,
      createdAt: collection.createdAt || now,
      updatedAt: now,
    };
    this.data.collections.push(col);
    this.save();
    return col;
  }

  updateCollection(id: string, updates: Partial<ApiCollection>): ApiCollection | undefined {
    const idx = this.data.collections.findIndex(c => c.id === id);
    if (idx < 0) return undefined;
    this.data.collections[idx] = {
      ...this.data.collections[idx]!,
      ...updates,
      id, // Prevent ID change
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.data.collections[idx];
  }

  deleteCollection(id: string): boolean {
    const len = this.data.collections.length;
    this.data.collections = this.data.collections.filter(c => c.id !== id);
    if (this.data.collections.length !== len) {
      this.save();
      return true;
    }
    return false;
  }

  // ── Request CRUD ────────────────────────────────────────────────────────

  /** Add or update a request in a collection (root-level or inside a folder). */
  saveRequest(collectionId: string, request: ApiRequest, folderId?: string): ApiRequest | undefined {
    const col = this.getCollection(collectionId);
    if (!col) return undefined;

    if (folderId) {
      const folder = col.folders.find(f => f.id === folderId);
      if (!folder) return undefined;
      const idx = folder.requests.findIndex(r => r.id === request.id);
      if (idx >= 0) {
        folder.requests[idx] = request;
      } else {
        folder.requests.push(request);
      }
    } else {
      const idx = col.requests.findIndex(r => r.id === request.id);
      if (idx >= 0) {
        col.requests[idx] = request;
      } else {
        col.requests.push(request);
      }
    }

    col.updatedAt = new Date().toISOString();
    this.save();
    return request;
  }

  deleteRequest(collectionId: string, requestId: string): boolean {
    const col = this.getCollection(collectionId);
    if (!col) return false;

    // Try root-level first
    const rootLen = col.requests.length;
    col.requests = col.requests.filter(r => r.id !== requestId);
    if (col.requests.length !== rootLen) {
      col.updatedAt = new Date().toISOString();
      this.save();
      return true;
    }

    // Try inside folders
    for (const folder of col.folders) {
      const folderLen = folder.requests.length;
      folder.requests = folder.requests.filter(r => r.id !== requestId);
      if (folder.requests.length !== folderLen) {
        col.updatedAt = new Date().toISOString();
        this.save();
        return true;
      }
    }

    return false;
  }

  /** Find a request by ID across all collections. */
  findRequest(requestId: string): { collection: ApiCollection; request: ApiRequest; folderId?: string } | undefined {
    for (const col of this.data.collections) {
      const rootReq = col.requests.find(r => r.id === requestId);
      if (rootReq) return { collection: col, request: rootReq };

      for (const folder of col.folders) {
        const folderReq = folder.requests.find(r => r.id === requestId);
        if (folderReq) return { collection: col, request: folderReq, folderId: folder.id };
      }
    }
    return undefined;
  }

  // ── Folder CRUD ─────────────────────────────────────────────────────────

  createFolder(collectionId: string, folder: ApiFolder): ApiFolder | undefined {
    const col = this.getCollection(collectionId);
    if (!col) return undefined;
    col.folders.push(folder);
    col.updatedAt = new Date().toISOString();
    this.save();
    return folder;
  }

  updateFolder(collectionId: string, folderId: string, updates: Partial<ApiFolder>): ApiFolder | undefined {
    const col = this.getCollection(collectionId);
    if (!col) return undefined;
    const idx = col.folders.findIndex(f => f.id === folderId);
    if (idx < 0) return undefined;
    col.folders[idx] = {
      ...col.folders[idx]!,
      ...updates,
      id: folderId,
    };
    col.updatedAt = new Date().toISOString();
    this.save();
    return col.folders[idx];
  }

  deleteFolder(collectionId: string, folderId: string): boolean {
    const col = this.getCollection(collectionId);
    if (!col) return false;
    const len = col.folders.length;
    col.folders = col.folders.filter(f => f.id !== folderId);
    if (col.folders.length !== len) {
      col.updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  // ── Environment CRUD ────────────────────────────────────────────────────

  getEnvironments(collectionId: string): ApiEnvironment[] {
    const col = this.getCollection(collectionId);
    return col?.environments || [];
  }

  saveEnvironment(collectionId: string, env: ApiEnvironment): ApiEnvironment | undefined {
    const col = this.getCollection(collectionId);
    if (!col) return undefined;
    const idx = col.environments.findIndex(e => e.id === env.id);
    if (idx >= 0) {
      col.environments[idx] = env;
    } else {
      col.environments.push(env);
    }
    col.updatedAt = new Date().toISOString();
    this.save();
    return env;
  }

  deleteEnvironment(collectionId: string, envId: string): boolean {
    const col = this.getCollection(collectionId);
    if (!col) return false;
    const len = col.environments.length;
    col.environments = col.environments.filter(e => e.id !== envId);
    if (col.environments.length !== len) {
      col.updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  // ── History ─────────────────────────────────────────────────────────────

  getHistory(limit = 50): ApiHistoryEntry[] {
    return this.data.history.slice(0, limit);
  }

  addHistoryEntry(request: ApiRequest, response: ApiResponse, collectionId?: string): void {
    const entry: ApiHistoryEntry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      request,
      response,
      collectionId,
      timestamp: new Date().toISOString(),
    };
    this.data.history.unshift(entry);
    if (this.data.history.length > MAX_HISTORY) {
      this.data.history.length = MAX_HISTORY;
    }
    this.save();
  }

  clearHistory(): void {
    this.data.history = [];
    this.save();
  }

  // ── Import ──────────────────────────────────────────────────────────────

  importCollection(collection: ApiCollection): ApiCollection {
    return this.createCollection(collection);
  }

  // ── Export ──────────────────────────────────────────────────────────────

  exportCollection(id: string): ApiCollection | undefined {
    return this.getCollection(id);
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          collections: Array.isArray(parsed.collections) ? parsed.collections : [],
          history: Array.isArray(parsed.history) ? parsed.history : [],
        };
      }
    } catch {
      this.data = { collections: [], history: [] };
    }
  }

  private save(): void {
    try {
      const dir = getQabotDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {
      // Silently ignore write failures
    }
  }
}
