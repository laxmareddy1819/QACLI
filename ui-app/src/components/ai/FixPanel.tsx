import { useState } from 'react';
import { Wrench, Copy, Check } from 'lucide-react';
import { aiFix } from '../../api/client';
import { useToast } from '../shared/Toast';

export function FixPanel() {
  const { toast } = useToast();
  const [testPath, setTestPath] = useState('');
  const [errorOutput, setErrorOutput] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleFix = async () => {
    if (!testPath.trim() || !errorOutput.trim()) {
      toast('error', 'Provide both test path and error output');
      return;
    }
    setLoading(true);
    setResult('');
    try {
      const res = await aiFix({ testPath, errorOutput });
      setResult(res.content);
    } catch (err) {
      toast('error', `Fix failed: ${err}`);
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
        <div>
          <label className="text-sm text-gray-400 block mb-1.5 font-medium">Test file path</label>
          <input
            value={testPath}
            onChange={(e) => setTestPath(e.target.value)}
            placeholder="e.g., tests/login.spec.ts"
            className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50"
          />
        </div>

        <div>
          <label className="text-sm text-gray-400 block mb-1.5 font-medium">Error output (paste from terminal)</label>
          <textarea
            value={errorOutput}
            onChange={(e) => setErrorOutput(e.target.value)}
            placeholder="Paste the error output from your test run here..."
            rows={5}
            className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 resize-none font-mono"
          />
        </div>

        <button
          onClick={handleFix}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[15px] font-medium disabled:opacity-50"
        >
          <Wrench size={16} />
          {loading ? 'Analyzing...' : 'Fix Test'}
        </button>
      </div>

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
