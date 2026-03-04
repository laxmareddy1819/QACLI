import { useState } from 'react';
import { Sparkles, Copy, Check } from 'lucide-react';
import { aiGenerate } from '../../api/client';
import { useToast } from '../shared/Toast';

const TYPES = [
  { value: 'test', label: 'Test Spec', description: 'Generate a test file' },
  { value: 'page', label: 'Page Object', description: 'Generate a page object class' },
  { value: 'step', label: 'Step Definition', description: 'Generate Cucumber step definitions' },
  { value: 'api', label: 'API Test', description: 'Generate an API test' },
  { value: 'data', label: 'Test Data', description: 'Generate test data files' },
];

export function GenerateForm() {
  const { toast } = useToast();
  const [type, setType] = useState('test');
  const [description, setDescription] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) { toast('error', 'Enter a description'); return; }
    setLoading(true);
    setResult('');
    try {
      const res = await aiGenerate({ type, description });
      setResult(res.content);
    } catch (err) {
      toast('error', `Generation failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 space-y-5 flex-shrink-0 max-w-5xl">
        {/* Type selector */}
        <div>
          <label className="text-sm text-gray-400 block mb-2.5 font-medium">What to generate?</label>
          <div className="flex gap-2.5 flex-wrap">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`px-4 py-2.5 rounded-lg text-[15px] border transition-colors ${
                  type === t.value
                    ? 'bg-brand-500/20 text-brand-300 border-brand-500/30'
                    : 'bg-surface-2 text-gray-400 border-white/5 hover:border-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-sm text-gray-400 block mb-1.5 font-medium">Describe what you need</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={`e.g., "Login page test with valid and invalid credentials" or "User API CRUD endpoints test"`}
            rows={3}
            className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 resize-none"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium disabled:opacity-50"
        >
          <Sparkles size={16} />
          {loading ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="flex-1 overflow-auto border-t border-white/5 relative">
          <div className="absolute top-3 right-3 z-10">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm text-gray-400"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-5 text-sm text-gray-200 font-mono whitespace-pre-wrap">{result}</pre>
        </div>
      )}
    </div>
  );
}
