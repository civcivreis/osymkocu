import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { adminCard, adminGhost } from '@/src/features/admin/adminUi';
import { canModerate, mapAdminError } from '@/src/features/admin/roles';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

type Row = {
  id: string;
  uploader_user_id: string;
  uploader_name: string;
  asset_key: string;
  status: string;
  categories: Record<string, unknown>;
  created_at: string;
  media_id: string | null;
  conversation_id: string | null;
};

export function AdminModerationScreen() {
  const role = useAuthStore((s) => s.profile?.app_role);
  const [reveal, setReveal] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin-media-moderation'],
    enabled: canModerate(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_list_media_moderation', { p_status: 'rejected' });
      if (error) throw new Error(mapAdminError(error.message));
      return (Array.isArray(data) ? data : []) as Row[];
    },
  });

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Moderasyon</AppText>
      <AppText tone="muted">Reddedilen görsel denemeleri. Güvensiz görsel varsayılan olarak gösterilmez.</AppText>
      {list.isLoading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
      {(list.data ?? []).length === 0 && !list.isLoading ? <AppText tone="muted">Kayıt yok.</AppText> : null}
      {(list.data ?? []).map((row) => (
        <View key={row.id} style={adminCard}>
          <AppText>{row.uploader_name}</AppText>
          <AppText variant="caption" tone="muted">
            {row.status} · {String(row.created_at).slice(0, 16).replace('T', ' ')} · {row.conversation_id ? 'sohbet' : 'yükleme'}
          </AppText>
          <AppText variant="caption" tone="muted">
            Özet: {row.categories && typeof row.categories === 'object' ? Object.keys(row.categories).join(', ') || '—' : '—'}
          </AppText>
          {row.media_id ? (
            <Pressable onPress={() => setReveal((cur) => (cur === row.id ? null : row.id))} style={adminGhost}>
              <AppText variant="caption">{reveal === row.id ? 'Gizle' : 'Önizlemeyi göster'}</AppText>
            </Pressable>
          ) : null}
          {reveal === row.id && row.media_id ? (
            <RemoteImage mediaId={row.media_id} style={{ width: 160, height: 120, borderRadius: 8, opacity: 0.55 }} />
          ) : null}
        </View>
      ))}
    </View>
  );
}
