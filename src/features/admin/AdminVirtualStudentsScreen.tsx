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
        <AppText variant="subtitle">Durum</AppText>
        <AppText>
          Açık {row.enabled_profiles ?? 0} · çevrimiçi {row.online ?? 0} · ders {row.studying ?? 0} · test {row.testing ?? 0} · oda{' '}
          {row.in_rooms ?? 0} · sosyal {row.social ?? 0}
        </AppText>
        <AppText variant="caption">
          Bugünkü sanal XP {row.daily_xp ?? 0} · kuyruk {row.jobs?.queued ?? 0} · hata {row.jobs?.failed ?? 0} · sohbet hatası{' '}
          {row.conversation_errors ?? 0}
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
