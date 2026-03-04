import React, { useState } from 'react';
import { Sparkles, Send, FlaskConical, Wrench, BookOpen, MessageSquare, Plus, ClipboardCheck, Globe, Circle } from 'lucide-react';
import { GenerateForm } from './GenerateForm';
import { FixPanel } from './FixPanel';
import { ChatPanel } from './ChatPanel';
import { NewTestPanel } from './NewTestPanel';
import { CodeReviewPanel } from './CodeReviewPanel';
import { BrowserPanel } from './BrowserPanel';
import { RecorderPanel } from './RecorderPanel';

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

export function AIPanel() {
  const [tab, setTab] = useState<Tab>('new-test');

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
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2.5 px-5 py-3 text-[15px] font-medium transition-colors relative rounded-t-lg ${
              tab === t.id
                ? 'text-brand-300 bg-surface-1/50'
                : 'text-gray-500 hover:text-gray-300 hover:bg-surface-1/30'
            }`}
          >
            {t.id === 'record' && tab === 'record'
              ? React.cloneElement(t.icon as React.ReactElement, { className: 'fill-red-400 text-red-400' })
              : t.icon
            }
            {t.label}
            {tab === t.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-t" />
            )}
          </button>
        ))}
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
