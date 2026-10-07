import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { getSupabase } from '@/src/lib/supabase/client';

import type { OnboardingValues } from './schema';

export async function saveOnboarding(values: OnboardingValues) {
  const kpss = values.examKind === 'kpss_lisans' || values.examKind === 'kpss_onlisans';

  const { error } = await getSupabase().rpc('save_onboarding', {
    p_exam_id: values.examId,
    p_exam_date: values.examDate,
    p_daily_minutes: values.dailyMinutes,
    p_target_score: values.targetScore,
    p_target_tyt_net: null,
    p_target_ayt_net: null,
    p_target_kpss_score: kpss ? values.targetScore : null,
    p_strong: values.strongSubjectIds,
    p_weak: values.weakSubjectIds,
    p_exam_year: values.examYear,
  });

  if (error) {
    if (__DEV__) console.warn('[onboarding]', error.message, error.code);
    throw new Error(mapOnboardingError(error.message));
  }

  AnalyticsProvider.track('onboarding_completed', { examId: values.examId });
  AnalyticsProvider.track('exam_selected', { examId: values.examId });
}

function mapOnboardingError(message: string): string {
  const lower = message.toLowerCase();
  if (message.includes('INVALID_EXAM_DATE')) return 'Sınav tarihi bugünden önce olamaz.';
  if (message.includes('INVALID_MINUTES')) return 'Günlük süre 20-360 dakika arasında olmalı.';
  if (message.includes('EXAM_NOT_FOUND')) return 'Sınav bulunamadı. SQL seed çalışmış mı kontrol et.';
  if (message.includes('UNAUTHORIZED') || message.includes('PROFILE_MISSING')) {
    return 'Oturum doğrulanamadı. Tekrar giriş yapıp dene.';
  }
  if (lower.includes('could not find the function')) {
    return 'Program kaydı şu an kullanılamıyor. Lütfen tekrar dene.';
  }
  if (
    lower.includes('foreign key') ||
    lower.includes('violates') ||
    lower.includes('user_exam_settings') ||
    message.includes('23503')
  ) {
    return 'Program oluşturulurken bir sorun oluştu. Lütfen tekrar dene.';
  }
  return 'Program oluşturulurken bir sorun oluştu. Lütfen tekrar dene.';
}
