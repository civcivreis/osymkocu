import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { applyXpAward } from '@/src/features/progress/xp';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { useAuthStore } from '@/src/stores/authStore';

import {
  completeLessonFinal,
  completeNarration,
  completeReview,
  getNextPublishedLesson,
  getReviewQueue,
  getLessonPrereqWarning,
  getStudentLessonCards,
  getStudentLessonMediaUrls,
  getTodayStudyRecommendations,
  loadPlayerPackage,
  submitCheckpoint,
  touchLessonProgress,
} from './playerApi';

export function useMemoryLessonPlayerPackage(lessonId: string | undefined) {
  return useQuery({
    queryKey: ['memory-lesson-player', lessonId],
    enabled: Boolean(lessonId),
    queryFn: () => loadPlayerPackage(lessonId!),
  });
}

export function useStudentLessonMedia(lessonId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['memory-lesson-media', lessonId],
    enabled: Boolean(lessonId) && enabled,
    staleTime: 4 * 60 * 1000,
    queryFn: () => getStudentLessonMediaUrls(lessonId!),
    retry: 1,
  });
}

export function useStudentLessonCards(examId: string | null, mode = 'recommended') {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['student-lesson-cards', examId, mode, userId],
    enabled: Boolean(examId && userId),
    staleTime: 60_000,
    queryFn: () => getStudentLessonCards(examId!, mode),
  });
}

export function useLessonPrereqWarning(lessonId: string | undefined) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['lesson-prereq-warning', lessonId, userId],
    enabled: Boolean(lessonId && userId),
    queryFn: () => getLessonPrereqWarning(lessonId!),
  });
}

export function useTodayStudyRecommendations(examId: string | null) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['today-study', examId, userId],
    enabled: Boolean(examId && userId),
    staleTime: 60_000,
    queryFn: () => getTodayStudyRecommendations(examId!),
  });
}

export function useReviewQueue() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['memory-review-queue', userId],
    enabled: Boolean(userId),
    queryFn: getReviewQueue,
  });
}

export function useNextMemoryLesson(lessonId: string | undefined, examId: string | undefined) {
  return useQuery({
    queryKey: ['next-memory-lesson', lessonId, examId],
    enabled: Boolean(lessonId && examId),
    queryFn: () => getNextPublishedLesson(lessonId!, examId!),
  });
}

export function useTouchLessonProgress() {
  return useMutation({
    mutationFn: (input: { lessonId: string; positionMs: number; durationMs?: number }) =>
      touchLessonProgress(input.lessonId, input.positionMs, input.durationMs),
  });
}

export function useSubmitCheckpoint() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: submitCheckpoint,
    onSuccess: async (_data, input) => {
      await client.invalidateQueries({ queryKey: ['memory-lesson-player', input.lessonId] });
    },
  });
}

export function useCompleteNarration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: completeNarration,
    onSuccess: async (data, lessonId) => {
      applyXpAward(data.xp, 'Ders tamamlandı');
      await client.invalidateQueries({ queryKey: ['memory-lesson-player', lessonId] });
      await client.invalidateQueries({ queryKey: ['student-lesson-cards'] });
    },
  });
}

export function useCompleteLessonFinal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: completeLessonFinal,
    onSuccess: async (_data, input) => {
      await client.invalidateQueries({ queryKey: ['memory-review-queue'] });
      await client.invalidateQueries({ queryKey: ['student-lesson-cards'] });
      await client.invalidateQueries({ queryKey: ['memory-lesson-player', input.lessonId] });
    },
  });
}

export function useCompleteReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: completeReview,
    onSuccess: async (data) => {
      AnalyticsProvider.track('review_completed');
      applyXpAward(data.xp, 'Tekrar tamamlandı');
      await client.invalidateQueries({ queryKey: ['memory-review-queue'] });
      await client.invalidateQueries({ queryKey: ['student-lesson-cards'] });
    },
  });
}
