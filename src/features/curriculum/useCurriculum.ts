import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { canManageExams, mapAdminError } from '@/src/features/admin/roles';
import { useAuthStore } from '@/src/stores/authStore';

import {
  activateCurriculumVersion,
  archiveCurriculumVersion,
  attachMemoryLesson,
  createCurriculumVersion,
  createExamCatalog,
  createSubjectCatalog,
  createTopicCatalog,
  createUnitCatalog,
  duplicateCurriculumVersion,
  findReusableLessons,
  getActiveCurriculumVersion,
  getStudentCurriculum,
  importCurriculum,
  listActiveExamCatalog,
  listCurriculumVersions,
  listExamCatalog,
  listExamTopicMap,
  listSubjectCatalog,
  listTopicCatalog,
  listUnitCatalog,
  scheduleCurriculumVersion,
  setCatalogActive,
  syncCurriculum,
  listCurriculumProposals,
  updateCatalogName,
} from './curriculumApi';

function wrap<T>(fn: () => Promise<T>) {
  return async () => {
    try {
      return await fn();
    } catch (error) {
      throw new Error(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
    }
  };
}

export function usePublicExamCatalog() {
  return useQuery({
    queryKey: ['exam-catalog', 'active'],
    queryFn: wrap(listActiveExamCatalog),
  });
}

export function useExamCatalog() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['exam-catalog'],
    enabled: canManageExams(role),
    queryFn: wrap(listExamCatalog),
  });
}

export function useSubjectCatalog(examId: string | null) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['subject-catalog', examId],
    enabled: canManageExams(role) && Boolean(examId),
    queryFn: wrap(() => listSubjectCatalog(examId!)),
  });
}

export function useUnitCatalog(subjectId: string | null) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['unit-catalog', subjectId],
    enabled: canManageExams(role) && Boolean(subjectId),
    queryFn: wrap(() => listUnitCatalog(subjectId!)),
  });
}

export function useTopicCatalog(unitId: string | null) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['topic-catalog', unitId],
    enabled: canManageExams(role) && Boolean(unitId),
    queryFn: wrap(() => listTopicCatalog(unitId!)),
  });
}

export function useCurriculumMutations() {
  const client = useQueryClient();
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['exam-catalog'] });
    await client.invalidateQueries({ queryKey: ['subject-catalog'] });
    await client.invalidateQueries({ queryKey: ['unit-catalog'] });
    await client.invalidateQueries({ queryKey: ['topic-catalog'] });
  };
  const invalidateVersions = async () => {
    await client.invalidateQueries({ queryKey: ['curriculum-versions'] });
    await client.invalidateQueries({ queryKey: ['exam-topic-map'] });
    await client.invalidateQueries({ queryKey: ['active-curriculum'] });
    await client.invalidateQueries({ queryKey: ['student-curriculum'] });
    await client.invalidateQueries({ queryKey: ['reusable-lessons'] });
  };
  return {
    createExam: useMutation({ mutationFn: createExamCatalog, onSuccess: invalidate }),
    createSubject: useMutation({ mutationFn: createSubjectCatalog, onSuccess: invalidate }),
    createUnit: useMutation({ mutationFn: createUnitCatalog, onSuccess: invalidate }),
    createTopic: useMutation({ mutationFn: createTopicCatalog, onSuccess: invalidate }),
    rename: useMutation({
      mutationFn: (input: { table: 'exam_catalog' | 'subject_catalog' | 'unit_catalog' | 'topic_catalog'; id: string; name: string }) =>
        updateCatalogName(input.table, input.id, input.name),
      onSuccess: invalidate,
    }),
    setActive: useMutation({
      mutationFn: (input: {
        table: 'exam_catalog' | 'subject_catalog' | 'unit_catalog' | 'topic_catalog';
        id: string;
        isActive: boolean;
      }) => setCatalogActive(input.table, input.id, input.isActive),
      onSuccess: invalidate,
    }),
    importJson: useMutation({ mutationFn: importCurriculum, onSuccess: invalidate }),
    syncCurriculum: useMutation({
      mutationFn: ({ examId, force }: { examId?: string | null; force?: boolean }) => syncCurriculum(examId, force),
      onSuccess: async () => {
        await invalidate();
        await client.invalidateQueries({ queryKey: ['curriculum-proposals'] });
        await client.invalidateQueries({ queryKey: ['factory-coverage'] });
      },
    }),
    createVersion: useMutation({
      mutationFn: createCurriculumVersion,
      onSuccess: invalidateVersions,
    }),
    activateVersion: useMutation({
      mutationFn: activateCurriculumVersion,
      onSuccess: invalidateVersions,
    }),
    scheduleVersion: useMutation({
      mutationFn: (input: { id: string; from: string | null; until: string | null }) =>
        scheduleCurriculumVersion(input.id, input.from, input.until),
      onSuccess: invalidateVersions,
    }),
    archiveVersion: useMutation({
      mutationFn: archiveCurriculumVersion,
      onSuccess: invalidateVersions,
    }),
    duplicateVersion: useMutation({
      mutationFn: duplicateCurriculumVersion,
      onSuccess: invalidateVersions,
    }),
    attachLesson: useMutation({
      mutationFn: (input: { lessonId: string; examId: string; usageMode?: string }) =>
        attachMemoryLesson(input.lessonId, input.examId, input.usageMode),
      onSuccess: invalidateVersions,
    }),
  };
}

export function useCurriculumProposals(examId?: string | null) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['curriculum-proposals', examId ?? 'all'],
    enabled: canManageExams(role),
    queryFn: wrap(() => listCurriculumProposals(examId)),
  });
}

export function useCurriculumVersions(examId: string | null) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['curriculum-versions', examId],
    enabled: canManageExams(role) && Boolean(examId),
    queryFn: wrap(() => listCurriculumVersions(examId!)),
  });
}

export function useActiveCurriculumVersion(examId: string | null) {
  return useQuery({
    queryKey: ['active-curriculum', examId],
    enabled: Boolean(examId),
    queryFn: wrap(() => getActiveCurriculumVersion(examId!)),
  });
}

export function useStudentCurriculum(examId: string | null) {
  return useQuery({
    queryKey: ['student-curriculum', examId],
    enabled: Boolean(examId),
    queryFn: wrap(() => getStudentCurriculum(examId!)),
  });
}

export function useExamTopicMap(versionId: string | null) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['exam-topic-map', versionId],
    enabled: canManageExams(role) && Boolean(versionId),
    queryFn: wrap(() => listExamTopicMap(versionId!)),
  });
}

export function useReusableLessons(topicId: string | null) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['reusable-lessons', topicId],
    enabled: canManageExams(role) && Boolean(topicId),
    queryFn: wrap(() => findReusableLessons(topicId!)),
  });
}
