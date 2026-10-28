import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { signLessonVideoUpload } from '@/src/features/memory-lessons/memoryLessonApi';
import { getSupabase } from '@/src/lib/supabase/client';

type LessonMedia = {
  id: string;
  title: string;
  topic: string;
  delivery_mode: string | null;
  video_key: string | null;
  status: string;
};

export function AdminMediaScreen() {
  const [rows, setRows] = useState<LessonMedia[]>([]);

  const load = () => {
    void getSupabase()
      .from('memory_lessons')
      .select('id, title, topic, delivery_mode, video_key, status')
      .order('updated_at', { ascending: false })
      .limit(120)
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else setRows((data ?? []) as LessonMedia[]);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const upload = (lessonId: string) => {
    if (typeof document === 'undefined') {
      toastError('Video yükleme web yöneticisinde.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void signLessonVideoUpload(lessonId, file.type || 'video/mp4')
        .then(async ({ put_url }) => {
          const res = await fetch(put_url, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type || 'video/mp4' },
          });
          if (!res.ok) throw new Error('Yükleme başarısız');
          await getSupabase().from('memory_lessons').update({ delivery_mode: 'video' }).eq('id', lessonId);
          toastSuccess('16:9 video yüklendi');
          load();
        })
        .catch((error: unknown) => toastError(error instanceof Error ? error.message : 'Yüklenemedi'));
    };
    input.click();
  };

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Medya</AppText>
      <AppText tone="muted">Elle 16:9 video yükle. Motor video üretmez. Zaman çizelgesi ders düzenleyicidedir.</AppText>
      {rows.map((row) => (
        <View key={row.id} style={adminCard}>
          <AppText variant="subtitle">{row.title}</AppText>
          <AppText variant="caption">
            {row.topic} · {row.delivery_mode ?? 'text'} · {row.video_key ? 'video var' : 'video yok'} · {row.status}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable onPress={() => upload(row.id)} style={adminBtn}>
              <AppText tone="inverse">Video Yükle</AppText>
            </Pressable>
            <Pressable onPress={() => router.push(`/admin/hafiza-dersleri/${row.id}?tab=zaman` as never)} style={adminGhost}>
              <AppText>Zaman çizelgesi</AppText>
            </Pressable>
            <Pressable onPress={() => router.push(`/admin/hafiza-dersleri/${row.id}?tab=medya` as never)} style={adminGhost}>
              <AppText>Ders medyası</AppText>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}
