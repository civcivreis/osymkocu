import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { versionLess } from '@/src/features/runtime/appRuntimeApi';
import { getSupabase } from '@/src/lib/supabase/client';

export function AdminReleasesScreen() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['admin-releases'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('app_releases').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [platform, setPlatform] = useState('web');
  const [version, setVersion] = useState('1.0.0');
  const [minimum, setMinimum] = useState('0.0.1');
  const [latest, setLatest] = useState('1.0.0');
  const [notes, setNotes] = useState('');
  const [mockCurrent, setMockCurrent] = useState('1.0.0');

  const mockAction = versionLess(mockCurrent, minimum)
    ? 'force'
    : versionLess(mockCurrent, latest)
      ? 'optional'
      : 'none';

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Uygulama Sürümleri</AppText>
      <AppText tone="muted">Mağaza/binary sürüm. Yeni konu veya soru yayınlamak için burayı kullanma; Yayın Yönetimi’ne git.</AppText>
      <View style={adminCard}>
        <AppText variant="caption">Kayıtlar varsayılan kapalıdır; gerçek kullanıcılara force update basılmaz.</AppText>
        <TextInput value={platform} onChangeText={setPlatform} placeholder="platform: ios/android/web/all" style={adminField} />
        <TextInput value={version} onChangeText={setVersion} placeholder="version" style={adminField} />
        <TextInput value={minimum} onChangeText={setMinimum} placeholder="minimum_supported_version" style={adminField} />
        <TextInput value={latest} onChangeText={setLatest} placeholder="latest_version" style={adminField} />
        <TextInput value={notes} onChangeText={setNotes} placeholder="Sürüm notları" multiline style={[adminField, { minHeight: 80 }]} />
        <Pressable
          onPress={() =>
            void getSupabase()
              .from('app_releases')
              .insert({
                platform,
                version,
                minimum_supported_version: minimum,
                latest_version: latest,
                title: 'Yeni sürüm mevcut',
                release_notes: notes,
                enabled: false,
                force_update: false,
              })
              .then(({ error }) => {
                if (error) toastError(mapAdminError(error.message));
                else {
                  toastSuccess('Sürüm taslak kaydedildi');
                  void client.invalidateQueries({ queryKey: ['admin-releases'] });
                }
              })
          }
          style={adminBtn}>
          <AppText tone="inverse">Taslak kaydet (enabled=false)</AppText>
        </Pressable>
      </View>
      <View style={adminCard}>
        <AppText variant="label">Karşılaştırma testi (yerel)</AppText>
        <TextInput value={mockCurrent} onChangeText={setMockCurrent} placeholder="yüklü sürüm" style={adminField} />
        <AppText>
          Sonuç: {mockAction === 'none' ? 'modal yok' : mockAction === 'optional' ? 'isteğe bağlı güncelle' : 'zorunlu güncelle'}
        </AppText>
      </View>
      {(list.data ?? []).map((row) => (
        <View key={row.id} style={adminCard}>
          <AppText>
            {row.platform} · {row.latest_version} · {row.enabled ? 'açık' : 'kapalı'}
          </AppText>
          <Pressable
            onPress={() =>
              void getSupabase()
                .from('app_releases')
                .update({ enabled: !row.enabled })
                .eq('id', row.id)
                .then(() => client.invalidateQueries({ queryKey: ['admin-releases'] }))
            }
            style={adminGhost}>
            <AppText>{row.enabled ? 'Kapat' : 'Aç'}</AppText>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
