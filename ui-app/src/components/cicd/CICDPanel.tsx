import { useState, useEffect, useCallback } from 'react';
import { Workflow, RefreshCw, Sparkles } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { useCICDPlatforms, useCICDDetect, useCICDGenerate, useCICDSave } from '../../hooks/useCICD';
import { PlatformCard } from './PlatformCard';
import { ConfigOptions } from './ConfigOptions';
import { ConfigPreview } from './ConfigPreview';
import { ExistingConfigs } from './ExistingConfigs';
import type { CICDPlatform, CICDOptions, CICDGenerateResult } from '../../api/types';

export function CICDPanel() {
  const { project } = useOutletContext<{ project: any }>();

  // Data fetching
  const { data: platformsData } = useCICDPlatforms();
  const { data: detectData, refetch: refetchDetect } = useCICDDetect();
  const generateMutation = useCICDGenerate();
  const saveMutation = useCICDSave();

  // State
  const [selectedPlatform, setSelectedPlatform] = useState<CICDPlatform | null>(null);
  const [options, setOptions] = useState<CICDOptions>({
    nodeVersion: '20',
    triggers: ['push', 'pull_request'],
    branches: ['main'],
    uploadArtifacts: true,
    timeout: 30,
    artifactRetention: 30,
  });
  const [generated, setGenerated] = useState<CICDGenerateResult | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [saved, setSaved] = useState(false);

  const platforms = platformsData?.platforms ?? [];
  const detectedConfigs = detectData?.configs ?? [];
  const projectFramework = detectData?.projectFramework ?? project?.framework ?? null;

  // Detect which platforms already have configs
  const existingPlatforms = new Set(detectedConfigs.map(c => c.platform));

  // Auto-generate when platform or options change
  const handleGenerate = useCallback(async () => {
    if (!selectedPlatform) return;

    setSaved(false);
    try {
      const result = await generateMutation.mutateAsync({
        platform: selectedPlatform,
        framework: projectFramework ?? undefined,
        options,
      });
      setGenerated(result);
      setEditedContent(result.content);
    } catch {
      // Error handled by mutation state
    }
  }, [selectedPlatform, options, projectFramework]);

  // Trigger generation when platform or options change
  useEffect(() => {
    if (selectedPlatform) {
      handleGenerate();
    }
  }, [selectedPlatform, options]);

  // Save handler
  function handleSave() {
    if (!generated) return;
    setSaved(false);
    saveMutation.mutate(
      { filePath: generated.filePath, content: editedContent },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
      },
    );
  }

  // Select platform
  function handlePlatformSelect(id: CICDPlatform) {
    setSelectedPlatform(id);
    setGenerated(null);
    setEditedContent('');
    setSaved(false);
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 bg-surface-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-500/15 rounded-xl">
              <Workflow size={22} className="text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-100">CI/CD Integration</h1>
              <p className="text-sm text-gray-500">
                Generate pipeline configurations for your test framework
                {projectFramework && (
                  <span className="ml-1 px-1.5 py-0.5 bg-brand-500/15 text-brand-300 rounded text-[10px] font-medium">
                    {projectFramework}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => refetchDetect()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm text-gray-400 hover:text-gray-200 bg-surface-2 hover:bg-surface-3 transition-colors"
          >
            <RefreshCw size={12} />
            Re-scan
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel — Platform Selection + Options */}
        <div className="w-80 flex-shrink-0 border-r border-white/5 overflow-y-auto p-4 space-y-5 bg-surface-1">
          {/* Existing Configs */}
          {detectedConfigs.length > 0 && (
            <ExistingConfigs configs={detectedConfigs} />
          )}

          {/* Platform Selection */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-brand-400" />
              <h3 className="text-base font-semibold text-gray-200">Generate New Config</h3>
            </div>
            <p className="text-sm text-gray-500">Select a CI/CD platform to generate a ready-to-use pipeline config</p>

            <div className="grid grid-cols-2 gap-2 mt-2">
              {platforms.map(p => (
                <PlatformCard
                  key={p.id}
                  platform={p}
                  selected={selectedPlatform === p.id}
                  hasExisting={existingPlatforms.has(p.id)}
                  onClick={() => handlePlatformSelect(p.id)}
                />
              ))}
            </div>
          </div>

          {/* Config Options (show when platform selected) */}
          {selectedPlatform && (
            <div className="border-t border-white/5 pt-4">
              <ConfigOptions
                platform={selectedPlatform}
                framework={projectFramework}
                options={options}
                onChange={setOptions}
              />
            </div>
          )}
        </div>

        {/* Right Panel — Preview */}
        <div className="flex-1 min-w-0">
          {generated && editedContent ? (
            <ConfigPreview
              content={editedContent}
              fileName={generated.fileName}
              filePath={generated.filePath}
              onChange={setEditedContent}
              onSave={handleSave}
              saving={saveMutation.isPending}
              saved={saved}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center mb-4">
                  <Workflow size={28} className="text-gray-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-300 mb-2">Select a Platform</h3>
                <p className="text-[15px] text-gray-500">
                  Choose a CI/CD platform from the left panel to generate a pipeline configuration
                  tailored to your {projectFramework ?? 'test'} framework.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
