import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminGhost } from '@/src/features/admin/adminUi';
import { canManageUsers, mapAdminError } from '@/src/features/admin/roles';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

type Overview = {
  settings?: {
    virtual_students_enabled?: boolean;
    xp_multiplier?: number;
    virtual_daily_xp_cap?: number;
    activity_intensity?: string;
    max_virtual_in_top5?: number;
    target_virtual_share?: number;
    virtual_social_enabled?: boolean;
    deterministic_social_only?: boolean;
    social_post_interval_minutes?: number;
    social_comment_interval_minutes?: number;
    social_like_interval_minutes?: number;
    social_text_enabled?: boolean;
    social_image_enabled?: boolean;
    social_like_enabled?: boolean;
    social_comment_enabled?: boolean;
    social_follow_enabled?: boolean;
    social_image_ai_enabled?: boolean;
    social_post_ttl_hours?: number;
    story_ttl_hours?: number;
    achievement_post_ttl_hours?: number;
    social_image_per_day?: number;
    social_max_virtual_likes_per_post?: number;
    social_max_virtual_comments_per_post?: number;
    social_max_virtual_follows_per_user_window?: number;
    social_human_engagement_share?: number;
    social_study_request_enabled?: boolean;
  };
  enabled_profiles?: number;
  online?: number;
  studying?: number;
  testing?: number;
  in_rooms?: number;
  social?: number;
  daily_xp?: number;
  jobs?: { queued?: number; running?: number; failed?: number };
  conversation_errors?: number;
  scheduler?: string;
  stall?: boolean;
  stall_message?: string | null;
  last_virtual_activity?: string | null;
  last_tick_at?: string | null;
  eligible_now?: number;
  rooms?: number;
  rooms_target?: number;
  surfaces?: {
    lesson?: string | null;
    test?: string | null;
    room?: string | null;
    social?: string | null;
    group_chat?: string | null;
  };
  profiles?: {
    id: string;
    display_name: string;
    display_tag?: number;
    current_xp: number;
    is_enabled: boolean;
    activity_intensity: string;
    xp_multiplier: number;
    exam_name?: string | null;
    state?: string | null;
  }[];
};

export function AdminVirtualStudentsScreen() {
  const role = useAuthStore((s) => s.profile?.app_role);
  const client = useQueryClient();
  const [sim, setSim] = useState<string>('');
  const overview = useQuery({
    queryKey: ['admin-virtual-students'],
    enabled: canManageUsers(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_virtual_students_overview');
      if (error) throw new Error(mapAdminError(error.message));
      return data as Overview;
    },
  });
  const budget = useQuery({
    queryKey: ['admin-virtual-ai-budget'],
    enabled: canManageUsers(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_virtual_ai_budget');
      if (error) throw new Error(mapAdminError(error.message));
      return data as {
        ai_calls_today?: number;
        estimated_tokens_today?: number;
        queued_ai?: number;
        policy?: { global_daily_ai_calls?: number; per_profile_daily_ai_calls?: number };
        tier_mix_today?: { t1?: number; t2?: number; t3?: number };
        ai_calls_by_activity?: Record<string, number>;
      };
    },
  });

  const row = overview.data ?? {};
  const settings = row.settings ?? {};
  const enabled = Boolean(settings.virtual_students_enabled);

  const save = (patch: Record<string, unknown>) => {
    void getSupabase()
      .rpc('admin_set_virtual_engine', patch)
      .then(({ error }) => {
        if (error) toastError(mapAdminError(error.message));
        else {
          toastSuccess('Ayar kaydedildi');
          void overview.refetch();
        }
      });
  };

  const toggleProfile = (id: string, on: boolean) => {
    void getSupabase()
      .rpc('admin_set_virtual_profile', { p_profile: id, p_enabled: on })
      .then(({ error }) => {
        if (error) toastError(mapAdminError(error.message));
        else void overview.refetch();
      });
  };

  const simulate = () => {
    void getSupabase()
      .rpc('admin_simulate_virtual_thread', { p_slug: 'kpss', p_count: 30 })
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else {
          const messages = (data as { messages?: { speaker?: string; body?: string }[] })?.messages ?? [];
          setSim(messages.map((m) => `${m.speaker}: ${m.body}`).join('\n'));
          toastSuccess('Simülasyon hazır');
        }
      });
  };

  const tick = () => {
    void getSupabase()
      .functions.invoke('virtual-student-tick', { body: {} })
      .then((res) => {
        if (res.error) toastError(res.error.message);
        else {
          toastSuccess('Motor tiki çalıştı');
          void client.invalidateQueries({ queryKey: ['admin-virtual-students'] });
        }
      });
  };

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Sanal Öğrenciler</AppText>
      <AppText tone="muted">
        Sistem kontrollü çalışma profilleri. Küresel anahtar kapalıyken yeni aktivite planlanmaz.
      </AppText>

      <View style={adminCard}>
        <AppText variant="subtitle">{enabled ? 'Motor açık' : 'Motor kapalı (önerilen)'}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable onPress={() => save({ p_enabled: !enabled })} style={enabled ? adminGhost : adminBtn}>
            <AppText variant="caption" style={!enabled ? { color: '#fff' } : undefined}>
              {enabled ? 'Tümünü duraklat' : 'Etkinleştir'}
            </AppText>
          </Pressable>
          <Pressable onPress={tick} style={adminGhost}>
            <AppText variant="caption">Tek tik</AppText>
          </Pressable>
          <Pressable onPress={simulate} style={adminGhost}>
            <AppText variant="caption">30 mesaj simüle et</AppText>
          </Pressable>
        </View>
        <AppText variant="caption">
          Yoğunluk {settings.activity_intensity ?? 'medium'} · XP x{settings.xp_multiplier ?? 0.4} · günlük cap{' '}
          {settings.virtual_daily_xp_cap ?? 120} · top5 sanal {settings.max_virtual_in_top5 ?? 1}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['low', 'medium', 'high'] as const).map((level) => (
            <Pressable key={level} onPress={() => save({ p_intensity: level })} style={adminGhost}>
              <AppText variant="caption">{level}</AppText>
            </Pressable>
          ))}
          <Pressable onPress={() => save({ p_multiplier: 0.4, p_daily_cap: 120 })} style={adminGhost}>
            <AppText variant="caption">XP 0.4 / 120</AppText>
          </Pressable>
        </View>
      </View>

      <View style={adminCard}>
        <AppText variant="subtitle">AI'siz sosyal mod</AppText>
        <AppText variant="caption" tone="muted">
          Açıkken sanal öğrenciler gönderi / beğeni / yorumu şablondan üretir. LLM bütçesi sıfır olsa da Sosyal durmaz.
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable
            onPress={() =>
              void getSupabase()
                .rpc('admin_set_virtual_social', {
                  p_enabled: !(settings.virtual_social_enabled !== false),
                })
                .then(({ error }) => {
                  if (error) toastError(mapAdminError(error.message));
                  else {
                    toastSuccess('Sosyal motor güncellendi');
                    void overview.refetch();
                  }
                })
            }
            style={settings.virtual_social_enabled === false ? adminBtn : adminGhost}>
            <AppText variant="caption" style={settings.virtual_social_enabled === false ? { color: '#fff' } : undefined}>
              {settings.virtual_social_enabled === false ? 'Sanal sosyal kapalı' : 'Sanal sosyal açık'}
            </AppText>
          </Pressable>
          <Pressable
            onPress={() =>
              void getSupabase()
                .rpc('admin_set_virtual_social', {
                  p_deterministic_only: !settings.deterministic_social_only,
                })
                .then(({ error }) => {
                  if (error) toastError(mapAdminError(error.message));
                  else {
                    toastSuccess("AI'siz sosyal güncellendi");
                    void overview.refetch();
                  }
                })
            }
            style={settings.deterministic_social_only ? adminBtn : adminGhost}>
            <AppText variant="caption" style={settings.deterministic_social_only ? { color: '#fff' } : undefined}>
              {settings.deterministic_social_only ? "AI'siz sosyal açık" : "AI'siz sosyal kapalı"}
            </AppText>
          </Pressable>
        </View>
        <AppText variant="caption" tone="muted">
          Gönderi {settings.social_post_interval_minutes ?? 18} dk · yorum {settings.social_comment_interval_minutes ?? 25} dk ·
          beğeni {settings.social_like_interval_minutes ?? 12} dk · paylaşım {settings.social_post_ttl_hours ?? 6} sa · başarı{' '}
          {settings.achievement_post_ttl_hours ?? 12} sa · story {settings.story_ttl_hours ?? 24} sa · görsel/gün{' '}
          {settings.social_image_per_day ?? 4}
        </AppText>
        <AppText variant="caption" tone="muted">
          Post başına en fazla {settings.social_max_virtual_likes_per_post ?? 6} sanal beğeni ·{' '}
          {settings.social_max_virtual_comments_per_post ?? 3} yorum · kullanıcıya 24s{' '}
          {settings.social_max_virtual_follows_per_user_window ?? 3} takip · gerçek kullanıcı payı %
          {Math.round((settings.social_human_engagement_share ?? 0.45) * 100)}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['p_text', 'Metin', settings.social_text_enabled !== false],
              ['p_image', 'Görsel', settings.social_image_enabled !== false],
              ['p_like', 'Beğeni', settings.social_like_enabled !== false],
              ['p_comment', 'Yorum', settings.social_comment_enabled !== false],
              ['p_follow', 'Takip', settings.social_follow_enabled !== false],
              ['p_image_ai', 'AI görsel', settings.social_image_ai_enabled === true],
              ['p_study_request', 'Çalışma isteği', settings.social_study_request_enabled !== false],
            ] as const
          ).map(([key, label, on]) => (
            <Pressable
              key={key}
              onPress={() =>
                void getSupabase()
                  .rpc('admin_set_virtual_social', { [key]: !on })
                  .then(({ error }) => {
                    if (error) toastError(mapAdminError(error.message));
                    else {
                      toastSuccess('Sosyal ayar güncellendi');
                      void overview.refetch();
                    }
                  })
              }
              style={on ? adminBtn : adminGhost}>
              <AppText variant="caption" style={on ? { color: '#fff' } : undefined}>
                {label} {on ? 'açık' : 'kapalı'}
              </AppText>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() =>
            void getSupabase()
              .rpc('admin_simulate_social_network', { p_steps: 12 })
              .then(({ data, error }) => {
                if (error) toastError(mapAdminError(error.message));
                else {
                  toastSuccess('Hızlandırılmış sosyal simülasyon bitti');
                  setSim(JSON.stringify(data));
                  void overview.refetch();
                }
              })
          }
          style={adminGhost}>
          <AppText variant="caption">12 adımlık sosyal simülasyon</AppText>
        </Pressable>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable
            onPress={() =>
              void getSupabase()
                .rpc('admin_set_virtual_social', {
                  p_max_likes_post: (settings.social_max_virtual_likes_per_post ?? 6) >= 6 ? 4 : 6,
                  p_max_comments_post: (settings.social_max_virtual_comments_per_post ?? 3) >= 3 ? 2 : 3,
                  p_max_follows_window: (settings.social_max_virtual_follows_per_user_window ?? 3) >= 3 ? 2 : 3,
                })
                .then(({ error }) => {
                  if (error) toastError(mapAdminError(error.message));
                  else {
                    toastSuccess('Etkileşim tavanı güncellendi');
                    void overview.refetch();
                  }
                })
            }
            style={adminGhost}>
            <AppText variant="caption">Beğeni/yorum/takip tavanı değiştir</AppText>
          </Pressable>
          <Pressable
            onPress={() =>
              void getSupabase()
                .rpc('admin_set_virtual_social', {
                  p_ttl_hours: 6,
                  p_achievement_ttl: 12,
                  p_story_ttl: 24,
                })
                .then(({ error }) => {
                  if (error) toastError(mapAdminError(error.message));
                  else {
                    toastSuccess('Paylaşım ömrü 6 / 12 / 24 saat');
                    void overview.refetch();
                  }
                })
            }
            style={adminGhost}>
            <AppText variant="caption">Ömür: post 6s · başarı 12s · story 24s</AppText>
          </Pressable>
          <Pressable
            onPress={() =>
              void getSupabase()
                .rpc('admin_set_virtual_social', {
                  p_human_share: (settings.social_human_engagement_share ?? 0.45) >= 0.45 ? 0.3 : 0.45,
                })
                .then(({ error }) => {
                  if (error) toastError(mapAdminError(error.message));
                  else {
                    toastSuccess('Gerçek kullanıcı payı güncellendi');
                    void overview.refetch();
                  }
                })
            }
            style={adminGhost}>
            <AppText variant="caption">Gerçek kullanıcı payını değiştir</AppText>
          </Pressable>
        </View>
      </View>

      <View style={adminCard}>
        <AppText variant="subtitle">Durum</AppText>
        {row.stall ? (
          <AppText tone="danger">{String(row.stall_message ?? 'Sanal öğrenci motorunda ilerleme yok.')}</AppText>
        ) : null}
        <AppText>
          Zamanlayıcı {String(row.scheduler ?? '—')} · Açık {row.enabled_profiles ?? 0} · şu an uygun {row.eligible_now ?? 0} ·
          çevrimiçi {row.online ?? 0} · ders {row.studying ?? 0} · test {row.testing ?? 0} · oda {row.in_rooms ?? 0} · sosyal{' '}
          {row.social ?? 0}
        </AppText>
        <AppText variant="caption">
          Odalar {row.rooms ?? 0}/{row.rooms_target ?? 6} · bugünkü sanal XP {row.daily_xp ?? 0} · kuyruk {row.jobs?.queued ?? 0} ·
          çalışan {row.jobs?.running ?? 0} · hata {row.jobs?.failed ?? 0}
        </AppText>
        <AppText variant="caption" tone="muted">
          Son test {row.surfaces?.test ? String(row.surfaces.test) : 'yok'} · son sosyal{' '}
          {row.surfaces?.social ? String(row.surfaces.social) : 'yok'} · son oda{' '}
          {row.surfaces?.room ? String(row.surfaces.room) : 'yok'} · son grup sohbeti{' '}
          {row.surfaces?.group_chat ? String(row.surfaces.group_chat) : 'yok'}
        </AppText>
        <AppText variant="caption" tone="muted">
          Son aktivite {row.last_virtual_activity ? String(row.last_virtual_activity) : 'yok'} · son tik{' '}
          {row.last_tick_at ? String(row.last_tick_at) : 'yok'}
        </AppText>
        <AppText variant="caption">
          AI bugün {budget.data?.ai_calls_today ?? 0}/{budget.data?.policy?.global_daily_ai_calls ?? 24} · token{' '}
          {budget.data?.estimated_tokens_today ?? 0} · kuyruk {budget.data?.queued_ai ?? 0} · T1{' '}
          {budget.data?.tier_mix_today?.t1 ?? 0} / T2 {budget.data?.tier_mix_today?.t2 ?? 0} / T3{' '}
          {budget.data?.tier_mix_today?.t3 ?? 0}
        </AppText>
        <AppText variant="caption" tone="muted">
          Cap dolunca sanal öğrenciler susmaz, şablonla devam eder. Test / oda / like / XP AI kullanmaz.
        </AppText>
      </View>

      {(row.profiles ?? []).map((profile) => (
        <View key={profile.id} style={adminCard}>
          <AppText variant="subtitle">
            {profile.display_name}
            {profile.display_tag ? `#${profile.display_tag}` : ''}
          </AppText>
          <AppText variant="caption" tone="muted">
            {profile.exam_name ?? 'Sınav yok'} · {profile.state ?? 'offline'} · {profile.current_xp} XP · x{profile.xp_multiplier}
          </AppText>
          <Pressable onPress={() => toggleProfile(profile.id, !profile.is_enabled)} style={adminGhost}>
            <AppText variant="caption">{profile.is_enabled ? 'Profili duraklat' : 'Profili aç'}</AppText>
          </Pressable>
        </View>
      ))}

      {sim ? (
        <View style={adminCard}>
          <AppText variant="subtitle">Simülasyon</AppText>
          <AppText variant="caption">{sim}</AppText>
        </View>
      ) : null}
    </View>
  );
}
