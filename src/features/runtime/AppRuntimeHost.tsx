import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { queryClient } from '@/src/lib/query/client';
import { useAuthStore } from '@/src/stores/authStore';

import {
  dismissAnnouncement,
  fetchActiveAnnouncements,
  fetchAppReleaseStatus,
  fetchContentRevision,
  type AppAnnouncement,
  type AppReleaseStatus,
} from './appRuntimeApi';

export function AppRuntimeHost() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const [announcement, setAnnouncement] = useState<AppAnnouncement | null>(null);
  const [release, setRelease] = useState<AppReleaseStatus | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    const pull = async () => {
      const nextRev = await fetchContentRevision();
      if (alive && nextRev && nextRev !== revision.current) {
        if (revision.current) {
          await queryClient.invalidateQueries({ queryKey: ['memory-lessons'] });
          await queryClient.invalidateQueries({ queryKey: ['student-curriculum'] });
          await queryClient.invalidateQueries({ queryKey: ['student-lesson-cards'] });
          await queryClient.invalidateQueries({ queryKey: ['exam-catalog'] });
          await queryClient.invalidateQueries({ queryKey: ['memory-lesson-player'] });
        }
        revision.current = nextRev;
      }
      const notes = await fetchActiveAnnouncements();
      if (alive) setAnnouncement(notes[0] ?? null);
      const status = await fetchAppReleaseStatus();
      if (alive) setRelease(status.action === 'none' ? null : status);
    };
    void pull();
    const timer = setInterval(() => void pull(), 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId]);

  const force = release?.action === 'force' && Platform.OS !== 'web';
  const optional = release?.action === 'optional' && Platform.OS !== 'web';

  return (
    <>
      <Modal visible={Boolean(announcement) && !force} transparent animationType="fade" onRequestClose={() => undefined}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#FFFCF7', borderRadius: 20, padding: 20, gap: 10 }}>
            <AppText variant="subtitle">{announcement?.title}</AppText>
            <AppText>{announcement?.body}</AppText>
            {(announcement?.bullets ?? []).map((line) => (
              <AppText key={line} variant="caption">
                • {line}
              </AppText>
            ))}
            <Pressable
              onPress={() => {
                if (!announcement) return;
                void dismissAnnouncement(announcement.id).finally(() => setAnnouncement(null));
              }}
              style={{ marginTop: 8, backgroundColor: '#C45C26', borderRadius: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">{announcement?.primary_label || 'Tamam'}</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(force || optional)} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.55)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#FFFCF7', borderRadius: 20, padding: 20, gap: 10 }}>
            <AppText variant="subtitle">{release?.title || (force ? "ÖSYM Koçu'nun yeni sürümü hazır." : 'Yeni sürüm mevcut')}</AppText>
            <AppText>
              {force
                ? 'Devam etmek için uygulamayı güncellemen gerekiyor.'
                : release?.release_notes || 'Yeni sürüm mevcut.'}
            </AppText>
            <Pressable
              onPress={() => {
                if (release?.store_url) void Linking.openURL(release.store_url);
              }}
              style={{ backgroundColor: '#C45C26', borderRadius: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">{force ? 'Güncelle' : 'Şimdi Güncelle'}</AppText>
            </Pressable>
            {optional ? (
              <Pressable onPress={() => setRelease(null)} style={{ minHeight: 40, alignItems: 'center', justifyContent: 'center' }}>
                <AppText>Daha Sonra</AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}
