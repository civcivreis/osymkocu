import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { canManageExams, mapAdminError } from '@/src/features/admin/roles';
import { useAuthStore } from '@/src/stores/authStore';

import {
  addBreakdownSuggestion,
  approveSuggestion,
  cancelFactoryJob,
  getFactoryExamCoverage,
  getFactorySettings,
  getFactoryStats,
  previewMotorAll,
  setFactoryExamEnabled,
  startContentMotor,
  listBreakdownSessions,
  listBreakdownSuggestions,
  listCanonicalTopics,
  listCanonicalUnits,
  listFactoryJobs,
  queueSingleTopic,
  previewOrQueueMissing,
  queueTestTopic,
  retryFailedJobs,
  retryFactoryJob,
  setFactoryPoolTarget,
  setFactoryProduction,
  suggestTopicBreakdown,
  tickFactoryProcess,
  updateSuggestion,
} from './factoryApi';

function wrap<T>(fn: () => Promise<T>) {
  return async () => {
    try {
      return await fn();
    } catch (error) {
      throw new Error(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
    }
  };
}

export function useFactorySettings() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['factory-settings'],
    enabled: canManageExams(role),
    queryFn: wrap(getFactorySettings),
  });
}

export function useFactoryStats() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['factory-stats'],
    enabled: canManageExams(role),
    refetchInterval: 8000,
    queryFn: wrap(getFactoryStats),
  });
}

export function useFactoryExamCoverage() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['factory-coverage'],
    enabled: canManageExams(role),
    refetchInterval: 8000,
    queryFn: wrap(getFactoryExamCoverage),
  });
}

export function useFactoryJobs() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['factory-jobs'],
    enabled: canManageExams(role),
    refetchInterval: 8000,
    queryFn: wrap(listFactoryJobs),
  });
}

export function useCanonicalTopics() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['canonical-topics'],
    enabled: canManageExams(role),
    queryFn: wrap(listCanonicalTopics),
  });
}

export function useCanonicalUnits() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['canonical-units'],
    enabled: canManageExams(role),
    queryFn: wrap(listCanonicalUnits),
  });
}

export function useFactoryMutations() {
  const client = useQueryClient();
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['factory-settings'] });
    await client.invalidateQueries({ queryKey: ['factory-stats'] });
    await client.invalidateQueries({ queryKey: ['factory-jobs'] });
    await client.invalidateQueries({ queryKey: ['breakdown-sessions'] });
    await client.invalidateQueries({ queryKey: ['factory-coverage'] });
  };
  return {
    setExamEnabled: useMutation({
      mutationFn: ({ examId, enabled }: { examId: string; enabled: boolean }) => setFactoryExamEnabled(examId, enabled),
      onSuccess: invalidate,
    }),
    previewMotor: useMutation({ mutationFn: previewMotorAll }),
    startMotor: useMutation({
      mutationFn: startContentMotor,
      onSuccess: invalidate,
    }),
    setProduction: useMutation({
      mutationFn: (input: { enabled: boolean; maxConcurrency?: number }) =>
        setFactoryProduction(input.enabled, input.maxConcurrency),
      onSuccess: invalidate,
    }),
    setPoolTarget: useMutation({
      mutationFn: setFactoryPoolTarget,
      onSuccess: invalidate,
    }),
    preview: useMutation({
      mutationFn: previewOrQueueMissing,
    }),
    queue: useMutation({
      mutationFn: previewOrQueueMissing,
      onSuccess: invalidate,
    }),
    queueTest: useMutation({
      mutationFn: queueTestTopic,
      onSuccess: invalidate,
    }),
    queueOne: useMutation({
      mutationFn: queueSingleTopic,
      onSuccess: invalidate,
    }),
    retry: useMutation({
      mutationFn: retryFactoryJob,
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: cancelFactoryJob,
      onSuccess: invalidate,
    }),
    retryFailed: useMutation({
      mutationFn: retryFailedJobs,
      onSuccess: invalidate,
    }),
    tick: useMutation({
      mutationFn: tickFactoryProcess,
      onSuccess: invalidate,
    }),
    breakdown: useMutation({
      mutationFn: suggestTopicBreakdown,
      onSuccess: invalidate,
    }),
    approveSuggestion: useMutation({
      mutationFn: approveSuggestion,
      onSuccess: invalidate,
    }),
    updateSuggestion: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => updateSuggestion(id, patch),
      onSuccess: invalidate,
    }),
    addSuggestion: useMutation({
      mutationFn: ({ sessionId, name }: { sessionId: string; name: string }) => addBreakdownSuggestion(sessionId, name),
      onSuccess: invalidate,
    }),
  };
}

export function useBreakdownSessions() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['breakdown-sessions'],
    enabled: canManageExams(role),
    queryFn: wrap(listBreakdownSessions),
  });
}

export function useBreakdownSuggestions(sessionId: string | null) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['breakdown-suggestions', sessionId],
    enabled: canManageExams(role) && Boolean(sessionId),
    queryFn: wrap(() => listBreakdownSuggestions(sessionId!)),
  });
}
