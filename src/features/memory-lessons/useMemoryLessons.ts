import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { canManageExams, mapAdminError } from '@/src/features/admin/roles';
import { useAuthStore } from '@/src/stores/authStore';

import {
  approveMemoryLesson,
  createMemoryLesson,
  generateMemoryLesson,
  generateMemoryLessonMedia,
  getAdminMemoryLesson,
  getLessonMediaUrls,
  getMemoryLessonBySlug,
  getMemoryLessonQuestions,
  getMemoryLessonScenes,
  getPublishedMemoryLessons,
  listAdminMemoryLessons,
  publishMemoryLesson,
  saveMemoryLessonReview,
} from './memoryLessonApi';
import type { MemoryLessonCreateInput, MemoryLessonMediaMode } from './types';

export function usePublishedMemoryLessons() {
  return useQuery({
    queryKey: ['memory-lessons', 'published'],
    queryFn: getPublishedMemoryLessons,
  });
}

export function useMemoryLessonBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ['memory-lessons', 'slug', slug],
    enabled: Boolean(slug),
    queryFn: () => getMemoryLessonBySlug(slug!),
  });
}

export function useMemoryLessonScenes(lessonId: string | undefined) {
  return useQuery({
    queryKey: ['memory-lessons', 'scenes', lessonId],
    enabled: Boolean(lessonId),
    queryFn: () => getMemoryLessonScenes(lessonId!),
  });
}

export function useMemoryLessonQuestions(lessonId: string | undefined) {
  return useQuery({
    queryKey: ['memory-lessons', 'questions', lessonId],
    enabled: Boolean(lessonId),
    queryFn: () => getMemoryLessonQuestions(lessonId!),
  });
}

export function useAdminMemoryLessons() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-memory-lessons'],
    enabled: canManageExams(role),
    queryFn: async () => {
      try {
        return await listAdminMemoryLessons();
      } catch (error) {
        throw new Error(mapAdminError(error instanceof Error ? error.message : 'Liste alınamadı.'));
      }
    },
  });
}

export function useCreateMemoryLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MemoryLessonCreateInput) => createMemoryLesson(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin-memory-lessons'] });
    },
  });
}

export function useAdminMemoryLesson(id: string | undefined) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-memory-lesson', id],
    enabled: canManageExams(role) && Boolean(id),
    queryFn: () => getAdminMemoryLesson(id!),
  });
}

export function useGenerateMemoryLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => generateMemoryLesson(lessonId),
    onSuccess: async (_data, lessonId) => {
      await client.invalidateQueries({ queryKey: ['admin-memory-lessons'] });
      await client.invalidateQueries({ queryKey: ['admin-memory-lesson', lessonId] });
      await client.invalidateQueries({ queryKey: ['memory-lessons', 'scenes', lessonId] });
      await client.invalidateQueries({ queryKey: ['memory-lessons', 'questions', lessonId] });
    },
  });
}

export function useGenerateMemoryLessonMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { lessonId: string; mode?: MemoryLessonMediaMode; sceneId?: string }) =>
      generateMemoryLessonMedia(input),
    onSuccess: async (_data, input) => {
      await client.invalidateQueries({ queryKey: ['admin-memory-lessons'] });
      await client.invalidateQueries({ queryKey: ['admin-memory-lesson', input.lessonId] });
      await client.invalidateQueries({ queryKey: ['memory-lessons', 'scenes', input.lessonId] });
      await client.invalidateQueries({ queryKey: ['admin-memory-lesson-media', input.lessonId] });
    },
  });
}

export function useLessonMediaUrls(lessonId: string | undefined, enabled: boolean) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-memory-lesson-media', lessonId],
    enabled: canManageExams(role) && Boolean(lessonId) && enabled,
    staleTime: 4 * 60 * 1000,
    queryFn: () => getLessonMediaUrls(lessonId!),
  });
}

export function useSaveMemoryLessonReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveMemoryLessonReview,
    onSuccess: async (_data, input) => {
      await client.invalidateQueries({ queryKey: ['admin-memory-lesson', input.lesson.id] });
      await client.invalidateQueries({ queryKey: ['memory-lessons', 'scenes', input.lesson.id] });
      await client.invalidateQueries({ queryKey: ['memory-lessons', 'questions', input.lesson.id] });
    },
  });
}

export function useApproveMemoryLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: approveMemoryLesson,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin-memory-lessons'] });
      await client.invalidateQueries({ queryKey: ['admin-memory-lesson'] });
    },
  });
}

export function usePublishMemoryLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: publishMemoryLesson,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin-memory-lessons'] });
      await client.invalidateQueries({ queryKey: ['admin-memory-lesson'] });
      await client.invalidateQueries({ queryKey: ['memory-lessons', 'published'] });
    },
  });
}
