import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

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
    throw new Error(mapOnboardingError(error.message));
  }

  const userId = useAuthStore.getState().session?.user.id;
  if (userId) {
    await fetchAuthExtras(userId);
  }
  AnalyticsProvider.track('onboarding_completed', { examId: values.examId });
  AnalyticsProvider.track('exam_selected', { examId: values.examId });
}

function mapOnboardingError(message: string): string {
  if (message.includes('INVALID_EXAM_DATE')) return 'Sınav tarihi bugünden önce olamaz.';
  if (message.includes('INVALID_MINUTES')) return 'Günlük süre 20-360 dakika arasında olmalı.';
  if (message.includes('EXAM_NOT_FOUND')) return 'Sınav bulunamadı. SQL seed çalışmış mı kontrol et.';
  if (message.toLowerCase().includes('could not find the function')) {
    return 'save_onboarding güncel değil. 0005_social.sql içeriğini SQL Editor’da çalıştır.';
  }
  return message;
}
