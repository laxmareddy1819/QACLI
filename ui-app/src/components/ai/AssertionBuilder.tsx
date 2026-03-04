import { useState, useCallback } from 'react';
import {
  ClipboardCheck, Eye, Type as TypeIcon, Hash, ToggleLeft,
  CheckCircle2, X, Copy, Code,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AssertionBuilderProps {
  elementInfo: ElementInfo;
  onClose: () => void;
  /** Send to AI for advanced assertion generation */
  onSendToAI?: (instruction: string) => void;
}

type AssertionType = 'visible' | 'hidden' | 'text-contains' | 'text-equals' | 'exists' | 'count' | 'attribute' | 'enabled' | 'disabled';

interface AssertionDef {
  type: AssertionType;
  label: string;
  icon: React.ElementType;
  color: string;
  needsValue?: boolean;
  placeholder?: string;
}

// ── Assertion Types ──────────────────────────────────────────────────────────

const ASSERTION_TYPES: AssertionDef[] = [
  { type: 'visible', label: 'Is Visible', icon: Eye, color: 'text-emerald-400' },
  { type: 'hidden', label: 'Is Hidden', icon: Eye, color: 'text-gray-400' },
  { type: 'text-contains', label: 'Text Contains', icon: TypeIcon, color: 'text-blue-400', needsValue: true, placeholder: 'expected text...' },
  { type: 'text-equals', label: 'Text Equals', icon: TypeIcon, color: 'text-blue-400', needsValue: true, placeholder: 'exact text...' },
  { type: 'exists', label: 'Exists in DOM', icon: CheckCircle2, color: 'text-cyan-400' },
  { type: 'count', label: 'Count Equals', icon: Hash, color: 'text-amber-400', needsValue: true, placeholder: 'expected count...' },
  { type: 'attribute', label: 'Has Attribute', icon: Code, color: 'text-purple-400', needsValue: true, placeholder: 'attr=value' },
  { type: 'enabled', label: 'Is Enabled', icon: ToggleLeft, color: 'text-emerald-400' },
  { type: 'disabled', label: 'Is Disabled', icon: ToggleLeft, color: 'text-red-400' },
];

// ── Selector Generator ───────────────────────────────────────────────────────

function generateSelector(el: ElementInfo): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  if (el.className) {
    const cls = el.className.split(/\s+/).filter(Boolean)[0];
    if (cls) return `${tag}.${cls}`;
  }
  return tag;
}

// ── Code Generator ───────────────────────────────────────────────────────────

function generateAssertionCode(
  el: ElementInfo,
  assertionType: AssertionType,
  value: string,
  framework: 'playwright' | 'cypress',
): string {
  const selector = generateSelector(el);

  if (framework === 'playwright') {
    switch (assertionType) {
      case 'visible': return `await expect(page.locator('${selector}')).toBeVisible();`;
      case 'hidden': return `await expect(page.locator('${selector}')).toBeHidden();`;
      case 'text-contains': return `await expect(page.locator('${selector}')).toContainText('${value}');`;
      case 'text-equals': return `await expect(page.locator('${selector}')).toHaveText('${value}');`;
      case 'exists': return `await expect(page.locator('${selector}')).toHaveCount(1);`;
      case 'count': return `await expect(page.locator('${selector}')).toHaveCount(${value || '1'});`;
      case 'attribute': {
        const [attr, attrVal] = value.split('=');
        return attrVal
          ? `await expect(page.locator('${selector}')).toHaveAttribute('${attr}', '${attrVal}');`
          : `await expect(page.locator('${selector}')).toHaveAttribute('${attr || 'data-testid'}');`;
      }
      case 'enabled': return `await expect(page.locator('${selector}')).toBeEnabled();`;
      case 'disabled': return `await expect(page.locator('${selector}')).toBeDisabled();`;
    }
  }

  // Cypress
  switch (assertionType) {
    case 'visible': return `cy.get('${selector}').should('be.visible');`;
    case 'hidden': return `cy.get('${selector}').should('not.be.visible');`;
    case 'text-contains': return `cy.get('${selector}').should('contain.text', '${value}');`;
    case 'text-equals': return `cy.get('${selector}').should('have.text', '${value}');`;
    case 'exists': return `cy.get('${selector}').should('exist');`;
    case 'count': return `cy.get('${selector}').should('have.length', ${value || '1'});`;
    case 'attribute': {
      const [attr, attrVal] = value.split('=');
      return attrVal
        ? `cy.get('${selector}').should('have.attr', '${attr}', '${attrVal}');`
        : `cy.get('${selector}').should('have.attr', '${attr || 'data-testid'}');`;
    }
    case 'enabled': return `cy.get('${selector}').should('be.enabled');`;
    case 'disabled': return `cy.get('${selector}').should('be.disabled');`;
  }
}

// ── AssertionBuilder Component ───────────────────────────────────────────────

export function AssertionBuilder({ elementInfo, onClose, onSendToAI }: AssertionBuilderProps) {
  const [selectedType, setSelectedType] = useState<AssertionType>('visible');
  const [value, setValue] = useState('');
  const [framework, setFramework] = useState<'playwright' | 'cypress'>('playwright');
  const [copied, setCopied] = useState(false);

  const selectedDef = ASSERTION_TYPES.find(a => a.type === selectedType)!;
  const code = generateAssertionCode(elementInfo, selectedType, value, framework);
  const selector = generateSelector(elementInfo);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  const handleAIGenerate = () => {
    if (onSendToAI) {
      onSendToAI(
        `Generate a comprehensive set of test assertions for the element "${selector}" ` +
        `(a ${elementInfo.tagName} element${elementInfo.id ? ` with id="${elementInfo.id}"` : ''}) ` +
        `using ${framework === 'playwright' ? 'Playwright' : 'Cypress'} syntax. ` +
        `Include assertions for visibility, text content, attributes, and state.`
      );
      onClose();
    }
  };

  return (
    <div className="bg-surface-1 border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden w-[340px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-surface-2/50">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={13} className="text-purple-400" />
          <span className="text-xs font-semibold text-gray-300">Assertion Builder</span>
        </div>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-white/10 text-gray-600 hover:text-gray-400 transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Element info */}
      <div className="px-3 py-1.5 border-b border-white/5 bg-black/10">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">Element:</span>
          <code className="text-[10px] font-mono text-purple-400">{selector}</code>
        </div>
        <div className="text-[9px] text-gray-600 mt-0.5">
          &lt;{elementInfo.tagName}&gt; at ({Math.round(elementInfo.x)}, {Math.round(elementInfo.y)}) — {Math.round(elementInfo.width)}x{Math.round(elementInfo.height)}
        </div>
      </div>

      {/* Framework toggle */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] text-gray-500 mr-1">Framework:</span>
        <button
          onClick={() => setFramework('playwright')}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            framework === 'playwright'
              ? 'bg-green-500/15 text-green-400 border border-green-500/30'
              : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          Playwright
        </button>
        <button
          onClick={() => setFramework('cypress')}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            framework === 'cypress'
              ? 'bg-green-500/15 text-green-400 border border-green-500/30'
              : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          Cypress
        </button>
      </div>

      {/* Assertion types */}
      <div className="p-2 grid grid-cols-2 gap-1">
        {ASSERTION_TYPES.map((def) => {
          const Icon = def.icon;
          const isSelected = selectedType === def.type;
          return (
            <button
              key={def.type}
              onClick={() => { setSelectedType(def.type); setValue(''); }}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-left transition-colors ${
                isSelected
                  ? 'bg-white/10 border border-white/15 text-gray-200'
                  : 'text-gray-400 hover:bg-white/5 border border-transparent'
              }`}
            >
              <Icon size={11} className={isSelected ? def.color : 'text-gray-600'} />
              <span>{def.label}</span>
            </button>
          );
        })}
      </div>

      {/* Value input (if needed) */}
      {selectedDef.needsValue && (
        <div className="px-3 pb-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={selectedDef.placeholder}
            className="w-full px-2 py-1.5 rounded-lg bg-surface-2 border border-white/10 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/30"
          />
        </div>
      )}

      {/* Generated code */}
      <div className="px-3 pb-2">
        <div className="bg-black/30 rounded-lg p-2 border border-white/5 relative group">
          <code className="text-[10px] text-emerald-300 font-mono break-all leading-relaxed">{code}</code>
          <button
            onClick={handleCopy}
            className="absolute top-1 right-1 p-1 rounded bg-white/5 opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
            title="Copy to clipboard"
          >
            {copied ? (
              <CheckCircle2 size={11} className="text-emerald-400" />
            ) : (
              <Copy size={11} className="text-gray-400" />
            )}
          </button>
        </div>
      </div>

      {/* AI Generate button */}
      {onSendToAI && (
        <div className="px-3 pb-2">
          <button
            onClick={handleAIGenerate}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/20 text-[11px] font-medium hover:bg-purple-500/25 transition-colors"
          >
            <ClipboardCheck size={11} />
            Generate Full Assertions with AI
          </button>
        </div>
      )}
    </div>
  );
}
