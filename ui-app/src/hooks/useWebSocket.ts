import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage } from '../api/types';
import { getStoredToken, clearStoredToken } from '../api/client';

type MessageHandler = (msg: WSMessage) => void;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getStoredToken();
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws${tokenParam}`);

    ws.onopen = () => setConnected(true);
    ws.onclose = (event) => {
      setConnected(false);

      // 4001 = auth failure — clear token and redirect to login
      if (event.code === 4001) {
        clearStoredToken();
        window.location.href = '/login';
        return;
      }

      // Auto-reconnect after 2s
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        for (const handler of handlersRef.current) {
          handler(msg);
        }
      } catch { /* ignore parse errors */ }
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  const subscribe = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, subscribe, send };
}
