import { useQuery } from '@tanstack/react-query';
import { getModuleFiles } from '../api/client';

export function useModuleFiles(moduleId: string | undefined) {
  return useQuery({
    queryKey: ['moduleFiles', moduleId],
    queryFn: () => getModuleFiles(moduleId!),
    enabled: !!moduleId,
    staleTime: 15_000,
  });
}
