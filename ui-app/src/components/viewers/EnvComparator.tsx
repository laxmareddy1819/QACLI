import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEnvFiles, compareEnvs } from '../../api/client';
import { LoadingState } from '../shared/LoadingState';

export function EnvComparator() {
  const { data } = useQuery({ queryKey: ['envFiles'], queryFn: getEnvFiles });
  const [file1, setFile1] = useState('');
  const [file2, setFile2] = useState('');

  const { data: comparison, isLoading } = useQuery({
    queryKey: ['envCompare', file1, file2],
    queryFn: () => compareEnvs(file1, file2),
    enabled: !!file1 && !!file2 && file1 !== file2,
  });

  const envs = data?.environments ?? [];

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">Environment Comparator</h3>

      <div className="flex gap-3">
        <select
          value={file1}
          onChange={(e) => setFile1(e.target.value)}
          className="flex-1 bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
        >
          <option value="">Select environment 1...</option>
          {envs.map((e) => <option key={e.path} value={e.path}>{e.name}</option>)}
        </select>
        <select
          value={file2}
          onChange={(e) => setFile2(e.target.value)}
          className="flex-1 bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
        >
          <option value="">Select environment 2...</option>
          {envs.map((e) => <option key={e.path} value={e.path}>{e.name}</option>)}
        </select>
      </div>

      {isLoading && <LoadingState text="Comparing..." />}

      {comparison && (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th className="text-left px-3 py-2 text-gray-400 border-b border-white/5">Key</th>
                <th className="text-left px-3 py-2 text-gray-400 border-b border-white/5">{file1.split('/').pop()}</th>
                <th className="text-left px-3 py-2 text-gray-400 border-b border-white/5">{file2.split('/').pop()}</th>
                <th className="text-center px-3 py-2 text-gray-400 border-b border-white/5">Match</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(comparison.comparison).map(([key, vals]) => (
                <tr key={key} className={vals.match ? '' : 'bg-red-500/5'}>
                  <td className="px-3 py-1.5 font-mono text-gray-200 border-b border-white/3">{key}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-400 border-b border-white/3">{vals.file1 ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-400 border-b border-white/3">{vals.file2 ?? '—'}</td>
                  <td className="px-3 py-1.5 text-center border-b border-white/3">
                    {vals.match ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
