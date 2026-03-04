import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCICDPlatforms, detectCICDConfigs, generateCICD, saveCICDConfig } from '../api/client';
import type { CICDPlatform, CICDOptions } from '../api/types';

export function useCICDPlatforms() {
  return useQuery({
    queryKey: ['cicd-platforms'],
    queryFn: getCICDPlatforms,
    staleTime: Infinity, // Platforms don't change
  });
}

export function useCICDDetect() {
  return useQuery({
    queryKey: ['cicd-detect'],
    queryFn: detectCICDConfigs,
  });
}

export function useCICDGenerate() {
  return useMutation({
    mutationFn: (data: { platform: CICDPlatform; framework?: string; options?: CICDOptions }) =>
      generateCICD(data),
  });
}

export function useCICDSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { filePath: string; content: string }) => saveCICDConfig(data),
    onSuccess: () => {
      // Refresh detection after saving
      queryClient.invalidateQueries({ queryKey: ['cicd-detect'] });
    },
  });
}
