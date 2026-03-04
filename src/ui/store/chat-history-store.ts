import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir } from '../../utils/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO 8601
}

export interface ChatSession {
  id: string;
  title: string;         // Auto-generated from first user message
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
  messages: ChatMessage[];
  messageCount: number;
}

interface StoreData {
  sessions: ChatSession[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 100;

// ── ChatHistoryStore ─────────────────────────────────────────────────────────

export class ChatHistoryStore {
  private data: StoreData = { sessions: [] };
  private filePath: string;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'chat-history.json');
    this.load();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Get all sessions (summary only — no messages) */
  listSessions(): Array<Omit<ChatSession, 'messages'>> {
    return this.data.sessions.map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount,
    }));
  }

  /** Get a session by ID (with messages) */
  getSession(id: string): ChatSession | null {
    return this.data.sessions.find(s => s.id === id) || null;
  }

  /** Create a new session and return its ID */
  createSession(id: string, title: string): ChatSession {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
      messageCount: 0,
    };

    this.data.sessions.unshift(session);

    // Prune oldest sessions if exceeding max
    if (this.data.sessions.length > MAX_SESSIONS) {
      this.data.sessions = this.data.sessions.slice(0, MAX_SESSIONS);
    }

    this.save();
    return session;
  }

  /** Add a message to a session */
  addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.data.sessions.find(s => s.id === sessionId);
    if (!session) return;

    session.messages.push(message);
    session.messageCount = session.messages.length;
    session.updatedAt = new Date().toISOString();

    // Auto-update title from first user message if still default
    if (session.title === 'New Chat' && message.role === 'user') {
      session.title = message.content.slice(0, 80).replace(/\n/g, ' ').trim();
      if (message.content.length > 80) session.title += '...';
    }

    // Trim messages if exceeding max
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
      session.messageCount = session.messages.length;
    }

    // Move session to top (most recently updated first)
    this.data.sessions = this.data.sessions.filter(s => s.id !== sessionId);
    this.data.sessions.unshift(session);

    this.save();
  }

  /** Update session title */
  renameSession(id: string, title: string): boolean {
    const session = this.data.sessions.find(s => s.id === id);
    if (!session) return false;
    session.title = title;
    session.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  /** Delete a session */
  deleteSession(id: string): boolean {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter(s => s.id !== id);
    if (this.data.sessions.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Delete all sessions */
  clearAll(): void {
    this.data.sessions = [];
    this.save();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as StoreData;
        this.data = {
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        };
      }
    } catch {
      this.data = { sessions: [] };
    }
  }

  private save(): void {
    try {
      const dir = getQabotDir();
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(this.data), 'utf-8');
    } catch {
      // Silently ignore save failures
    }
  }
}
