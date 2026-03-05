import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Sparkles, Send, FlaskConical, Wrench, BookOpen, MessageSquare, Plus, ClipboardCheck, Globe, Circle, Lock, Pause, Play } from 'lucide-react';
import { GenerateForm } from './GenerateForm';
import { FixPanel } from './FixPanel';
import { ChatPanel } from './ChatPanel';
import { NewTestPanel } from './NewTestPanel';
import { CodeReviewPanel } from './CodeReviewPanel';
import { BrowserPanel } from './BrowserPanel';
import { RecorderPanel } from './RecorderPanel';
import { getBrowserStatus } from '../../api/client';
import type { WSMessage } from '../../api/types';

type Tab = 'new-test' | 'review' | 'browser' | 'record' | 'chat' | 'generate' | 'fix';

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'new-test', label: 'New Test', icon: <Plus size={16} className="text-emerald-400" /> },
  { id: 'review', label: 'Review', icon: <ClipboardCheck size={16} className="text-sky-400" /> },
  { id: 'browser', label: 'Browser', icon: <Globe size={16} className="text-purple-400" /> },
  { id: 'record', label: 'Record', icon: <Circle size={16} className="text-red-400" /> },
  { id: 'chat', label: 'Chat', icon: <MessageSquare size={16} className="text-amber-400" /> },
  { id: 'generate', label: 'Generate', icon: <FlaskConical size={16} className="text-brand-400" /> },
  { id: 'fix', label: 'Fix', icon: <Wrench size={16} className="text-orange-400" /> },
];

// Tabs that have interactive browser view (LiveBrowserWrapper)
const BROWSER_ENABLED_TABS = new Set<Tab>(['new-test', 'browser', 'record', 'chat']);

export function AIPanel() {
  const { subscribe, send } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    send: (msg: object) => void;
  }>();

  const [tab, setTab] = useState<Tab>('new-test');
  const [browserActive, setBrowserActive] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiPaused, setAiPaused] = useState(false);

  // ── Track browser status for tab locking ────────────────────────────────────

  useEffect(() => {
    // Check initial browser status
    getBrowserStatus()
      .then((status) => setBrowserActive(status.active))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = subscribe((msg: WSMessage) => {
      // ── AI orchestrator running/paused state (global) ──
      if (msg.type === 'ai-orchestrator-paused') {
        setAiPaused(true);
        return;
      }
      if (msg.type === 'ai-orchestrator-resumed') {
        setAiPaused(false);
        return;
      }
      // Detect AI streaming start from tool events or stream chunks
      if (msg.type === 'ai-fix-stream' || (msg.type === 'ai-fix-tool' && msg.phase === 'start')) {
        setAiRunning(true);
      }
      // Detect AI streaming end
      if (msg.type === 'ai-fix-done' || msg.type === 'ai-fix-error') {
        setAiRunning(false);
        setAiPaused(false);
      }

      // ── Browser status tracking ──
      if (msg.type === 'browser-launched') {
        setBrowserActive(true);
        return;
      }
      if (msg.type === 'browser-closed') {
        setBrowserActive(false);
        return;
      }
      // Also detect via recorder
      if (msg.type === 'recorder-status' && msg.status === 'recording') {
        setBrowserActive(true);
        return;
      }
      // Also detect via tool completion
      if (msg.type === 'ai-fix-tool' && msg.phase === 'complete') {
        if (msg.toolName === 'browser_launch') {
          setBrowserActive(true);
          return;
        }
        if (msg.toolName === 'browser_close') {
          setBrowserActive(false);
          return;
        }
      }
    });
    return unsub;
  }, [subscribe]);

  // Whether the current tab is showing the interactive browser view
  const currentTabHasBrowser = browserActive && BROWSER_ENABLED_TABS.has(tab);

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="px-6 pt-6 pb-0 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2.5">
          <Sparkles size={24} className="text-brand-400" />
          AI Assistant
        </h1>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-2 border-b border-white/5 px-6 mt-4 flex-shrink-0">
        {tabs.map(t => {
          const isActive = tab === t.id;
          const isDisabled = currentTabHasBrowser && !isActive;

          return (
            <button
              key={t.id}
              onClick={() => !isDisabled && setTab(t.id)}
              disabled={isDisabled}
              className={`flex items-center gap-2.5 px-5 py-3 text-[15px] font-medium transition-colors relative rounded-t-lg ${
                isActive
                  ? 'text-brand-300 bg-surface-1/50'
                  : isDisabled
                    ? 'text-gray-700 cursor-not-allowed opacity-50'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-surface-1/30'
              }`}
              title={isDisabled ? 'Close the browser session first to switch tabs' : undefined}
            >
              {t.id === 'record' && tab === 'record'
                ? React.cloneElement(t.icon as React.ReactElement, { className: 'fill-red-400 text-red-400' })
                : t.icon
              }
              {t.label}
              {isDisabled && <Lock size={10} className="text-gray-600 ml-0.5" />}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-t" />
              )}
            </button>
          );
        })}

        {/* Global Pause/Resume AI — visible in tab bar whenever AI is running */}
        {aiRunning && (
          <div className="ml-auto flex items-center">
            {!aiPaused ? (
              <button
                onClick={() => send({ type: 'screencast-pause' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-orange-600 border border-orange-400/40 hover:bg-orange-500 transition-colors shadow-sm"
              >
                <Pause size={12} /> Pause AI
              </button>
            ) : (
              <button
                onClick={() => send({ type: 'screencast-resume' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-emerald-600 border border-emerald-400/40 hover:bg-emerald-500 transition-colors shadow-sm animate-pulse"
              >
                <Play size={12} /> Resume AI
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden bg-surface-1">
        {tab === 'new-test' && <NewTestPanel />}
        {tab === 'review' && <CodeReviewPanel />}
        {tab === 'browser' && <BrowserPanel />}
        {tab === 'record' && <RecorderPanel />}
        {tab === 'chat' && <ChatPanel />}
        {tab === 'generate' && <GenerateForm />}
        {tab === 'fix' && <FixPanel />}
      </div>
    </div>
  );
}
