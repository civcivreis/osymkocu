import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { getSupabase } from '@/src/lib/supabase/client';

export function AdminAnnouncementsScreen() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('app_announcements')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [enabled, setEnabled] = useState(false);

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Uygulama Duyuruları</AppText>
      <AppText tone="muted">Öğrenciye Tamam modalı açılır. Mağaza veya sürüm güncellemesi göndermez.</AppText>
      <View style={adminCard}>
        <TextInput value={title} onChangeText={setTitle} placeholder="Başlık" style={adminField} />
        <TextInput value={body} onChangeText={setBody} placeholder="Metin" multiline style={[adminField, { minHeight: 90 }]} />
        <Pressable onPress={() => setEnabled((v) => !v)} style={adminGhost}>
          <AppText>{enabled ? 'Yayında' : 'Taslak (öğrenciye gösterilmez)'}</AppText>
        </Pressable>
        <Pressable
          onPress={() =>
            void getSupabase()
              .from('app_announcements')
                .insert({
                  title,
                  body,
                  bullets: body
                    .split('\n')
                    .map((line) => line.replace(/^[-•]\s*/, '').trim())
                    .filter((line) => line.length > 0 && line !== title.trim())
                    .slice(0, 6),
                  enabled,
                  display_mode: 'once',
                  platforms: ['all'],
                })
              .then(({ error }) => {
                if (error) toastError(mapAdminError(error.message));
                else {
                  toastSuccess('Duyuru kaydedildi');
                  void client.invalidateQueries({ queryKey: ['admin-announcements'] });
                }
              })
          }
          style={adminBtn}>
          <AppText tone="inverse">Kaydet</AppText>
        </Pressable>
      </View>
      {(list.data ?? []).map((row) => (
        <View key={row.id} style={adminCard}>
          <AppText variant="label">{row.title}</AppText>
          <AppText variant="caption">{row.enabled ? 'Açık' : 'Kapalı (test/taslak)'}</AppText>
          <Pressable
            onPress={() =>
              void getSupabase()
                .from('app_announcements')
                .update({ enabled: !row.enabled })
                .eq('id', row.id)
                .then(() => client.invalidateQueries({ queryKey: ['admin-announcements'] }))
            }
            style={adminGhost}>
            <AppText>{row.enabled ? 'Kapat' : 'Aç'}</AppText>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
