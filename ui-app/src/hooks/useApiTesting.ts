import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getApiCollections, getApiCollection, createApiCollection,
  updateApiCollection, deleteApiCollection, saveApiRequest,
  deleteApiRequest, createApiFolder, deleteApiFolder,
  sendApiRequest, getApiHistory, clearApiHistory,
  saveApiEnvironment, deleteApiEnvironment, importApiCollection,
} from '../api/client';
import type { ApiRequest, ApiCollection, ApiEnvironment } from '../api/types';

export function useApiCollections() {
  return useQuery({
    queryKey: ['api-collections'],
    queryFn: getApiCollections,
  });
}

export function useApiCollection(id: string | null) {
  return useQuery({
    queryKey: ['api-collection', id],
    queryFn: () => getApiCollection(id!),
    enabled: !!id,
  });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; baseUrl?: string }) =>
      createApiCollection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-collections'] });
    },
  });
}

export function useUpdateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ApiCollection> }) =>
      updateApiCollection(id, data),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['api-collections'] });
      queryClient.invalidateQueries({ queryKey: ['api-collection', vars.id] });
    },
  });
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteApiCollection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-collections'] });
    },
  });
}

export function useSaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, request, folderId }: {
      collectionId: string;
      request: ApiRequest;
      folderId?: string;
    }) => saveApiRequest(collectionId, request, folderId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['api-collection', vars.collectionId] });
    },
  });
}

export function useDeleteRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, requestId }: { collectionId: string; requestId: string }) =>
      deleteApiRequest(collectionId, requestId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['api-collection', vars.collectionId] });
    },
  });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, name }: { collectionId: string; name: string }) =>
      createApiFolder(collectionId, name),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['api-collection', vars.collectionId] });
    },
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, folderId }: { collectionId: string; folderId: string }) =>
      deleteApiFolder(collectionId, folderId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['api-collection', vars.collectionId] });
    },
  });
}

export function useSendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ request, variables, collectionId }: {
      request: ApiRequest;
      variables?: Record<string, string>;
      collectionId?: string;
    }) => sendApiRequest(request, variables, collectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-history'] });
    },
  });
}

export function useApiHistory(limit = 50) {
  return useQuery({
    queryKey: ['api-history', limit],
    queryFn: () => getApiHistory(limit),
  });
}

export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearApiHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-history'] });
    },
  });
}

export function useSaveEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, env }: { collectionId: string; env: ApiEnvironment }) =>
      saveApiEnvironment(collectionId, env),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['api-collection', vars.collectionId] });
    },
  });
}

export function useDeleteEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, envId }: { collectionId: string; envId: string }) =>
      deleteApiEnvironment(collectionId, envId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['api-collection', vars.collectionId] });
    },
  });
}

export function useImportCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ data, format }: { data: unknown; format?: string }) =>
      importApiCollection(data, format),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-collections'] });
    },
  });
}
