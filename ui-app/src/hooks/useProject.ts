import { useQuery } from '@tanstack/react-query';
import { getProject, rescanProject, getFileTree } from '../api/client';

export function useProject() {
  return useQuery({
    queryKey: ['project'],
    queryFn: getProject,
    staleTime: 30_000,
  });
}

export function useRescan() {
  return useQuery({
    queryKey: ['project', 'rescan'],
    queryFn: rescanProject,
    enabled: false,
  });
}

export function useFileTree() {
  return useQuery({
    queryKey: ['fileTree'],
    queryFn: getFileTree,
    staleTime: 30_000,
  });
}
