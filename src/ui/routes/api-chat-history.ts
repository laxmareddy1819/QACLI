import type { Express } from 'express';
import type { ChatHistoryStore } from '../store/chat-history-store.js';

export function mountChatHistoryRoutes(
  app: Express,
  chatHistoryStore: ChatHistoryStore,
): void {
  // GET /api/chat/sessions — List all sessions (summaries, no messages)
  app.get('/api/chat/sessions', (_req, res) => {
    try {
      const sessions = chatHistoryStore.listSessions();
      res.json({ sessions, count: sessions.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/chat/sessions/:id — Get a session with messages
  app.get('/api/chat/sessions/:id', (req, res) => {
    try {
      const session = chatHistoryStore.getSession(req.params.id!);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/chat/sessions — Create a new session
  app.post('/api/chat/sessions', (req, res) => {
    try {
      const { id, title } = req.body;
      if (!id) {
        res.status(400).json({ error: 'id required' });
        return;
      }
      const session = chatHistoryStore.createSession(id, title || 'New Chat');
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/chat/sessions/:id/messages — Add a message to a session
  app.post('/api/chat/sessions/:id/messages', (req, res) => {
    try {
      const { role, content } = req.body;
      if (!role || !content) {
        res.status(400).json({ error: 'role and content required' });
        return;
      }
      chatHistoryStore.addMessage(req.params.id!, {
        role,
        content,
        timestamp: new Date().toISOString(),
      });
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/chat/sessions/:id — Rename a session
  app.put('/api/chat/sessions/:id', (req, res) => {
    try {
      const { title } = req.body;
      if (!title) {
        res.status(400).json({ error: 'title required' });
        return;
      }
      const ok = chatHistoryStore.renameSession(req.params.id!, title);
      if (!ok) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/chat/sessions/:id — Delete a session
  app.delete('/api/chat/sessions/:id', (req, res) => {
    try {
      const ok = chatHistoryStore.deleteSession(req.params.id!);
      if (!ok) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ status: 'deleted' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/chat/sessions — Clear all sessions
  app.delete('/api/chat/sessions', (_req, res) => {
    try {
      chatHistoryStore.clearAll();
      res.json({ status: 'cleared' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
