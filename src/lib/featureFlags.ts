import { getSupabase } from '@/src/lib/supabase/client';

export type AppFeatureFlags = {
  premium_enabled: boolean;
  premium_matching_filters_enabled: boolean;
  premium_intro_messages_enabled: boolean;
  premium_intro_message_limit: number;
};

const DEFAULTS: AppFeatureFlags = {
  premium_enabled: false,
  premium_matching_filters_enabled: false,
  premium_intro_messages_enabled: false,
  premium_intro_message_limit: 2,
};

export function premiumUiEnabled(flags: AppFeatureFlags | null | undefined) {
  return Boolean(flags?.premium_enabled);
}

export async function fetchAppFeatureFlags(): Promise<AppFeatureFlags> {
  try {
    const { data, error } = await getSupabase().rpc('get_app_feature_flags');
    if (error || !data || typeof data !== 'object') return DEFAULTS;
    const row = data as Record<string, unknown>;
    return {
      premium_enabled: Boolean(row.premium_enabled),
      premium_matching_filters_enabled: Boolean(row.premium_matching_filters_enabled),
      premium_intro_messages_enabled: Boolean(row.premium_intro_messages_enabled),
      premium_intro_message_limit: Number(row.premium_intro_message_limit ?? 2) || 2,
    };
  } catch {
    return DEFAULTS;
  }
}
