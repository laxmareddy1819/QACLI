import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getHealingStats,
  getHealingAnalytics,
  getHealingEvents,
  getHealingInjections,
  getHealingAdapters,
  removeHealingInjection,
  getHealingFingerprints,
  deleteHealingFingerprint,
} from '../api/client';

export function useHealingStats() {
  return useQuery({
    queryKey: ['healing-stats'],
    queryFn: () => getHealingStats(),
    refetchInterval: 30000,
  });
}

export function useHealingAnalytics(days = 30) {
  return useQuery({
    queryKey: ['healing-analytics', days],
    queryFn: () => getHealingAnalytics(days),
    refetchInterval: 30000,
  });
}

export function useHealingEvents(filters?: {
  framework?: string; days?: number; success?: boolean; limit?: number;
}) {
  return useQuery({
    queryKey: ['healing-events', filters],
    queryFn: () => getHealingEvents(filters),
    refetchInterval: 15000,
  });
}

export function useHealingInjections(status?: string) {
  return useQuery({
    queryKey: ['healing-injections', status],
    queryFn: () => getHealingInjections(status),
    refetchInterval: 30000,
  });
}

export function useHealingAdapters() {
  return useQuery({
    queryKey: ['healing-adapters'],
    queryFn: () => getHealingAdapters(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRemoveInjection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeHealingInjection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['healing-injections'] }),
  });
}

export function useHealingFingerprints(params?: { search?: string; url?: string; offset?: number; limit?: number }) {
  return useQuery({
    queryKey: ['healing-fingerprints', params],
    queryFn: () => getHealingFingerprints(params),
    refetchInterval: 30000,
  });
}

export function useDeleteFingerprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteHealingFingerprint(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['healing-fingerprints'] });
      qc.invalidateQueries({ queryKey: ['healing-stats'] });
    },
  });
}
