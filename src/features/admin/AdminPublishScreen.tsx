import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { publishMemoryLesson } from '@/src/features/memory-lessons/memoryLessonApi';
import { getSupabase } from '@/src/lib/supabase/client';

type Row = {
  id: string;
  title: string;
  topic: string;
  status: string;
  editorial_status: string | null;
  delivery_mode: string | null;
};

export function AdminPublishScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<'all' | 'draft' | 'published' | 'archived'>('all');

  const load = () => {
    void getSupabase()
      .from('memory_lessons')
      .select('id, title, topic, status, editorial_status, delivery_mode')
      .order('updated_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else setRows((data ?? []) as Row[]);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((row) => row.status === filter || row.editorial_status === filter);
  }, [filter, rows]);

  const setStatus = (id: string, status: string) => {
    void getSupabase()
      .from('memory_lessons')
      .update({ status, editorial_status: status === 'published' ? 'published' : status })
      .eq('id', id)
      .then(({ error }) => {
        if (error) toastError(mapAdminError(error.message));
        else {
          toastSuccess('Durum güncellendi');
          load();
        }
      });
  };

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Yayın Yönetimi</AppText>
      <AppText tone="muted">Taslak öğrenciye görünmez. Yayın sen basınca açılır.</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['all', 'draft', 'published', 'archived'] as const).map((item) => (
          <Pressable key={item} onPress={() => setFilter(item)} style={[adminChip, filter === item && adminChipOn]}>
            <AppText>{item === 'all' ? 'Tümü' : item === 'draft' ? 'Taslak' : item === 'published' ? 'Yayında' : 'Arşiv'}</AppText>
          </Pressable>
        ))}
      </View>
      {visible.map((row) => (
        <View key={row.id} style={adminCard}>
          <AppText variant="subtitle">{row.title}</AppText>
          <AppText variant="caption">
            {row.topic} · {row.delivery_mode ?? 'text'} · {row.status}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable onPress={() => router.push(`/admin/hafiza-dersleri/${row.id}` as never)} style={adminGhost}>
              <AppText>Düzenle</AppText>
            </Pressable>
            <Pressable
              onPress={() =>
                void publishMemoryLesson(row.id)
                  .then(() => {
                    toastSuccess('Yayınlandı');
                    load();
                  })
                  .catch((error: unknown) => toastError(mapAdminError(error instanceof Error ? error.message : 'Yayınlanamadı')))
              }
              style={adminBtn}>
              <AppText tone="inverse">Yayınla</AppText>
            </Pressable>
            <Pressable onPress={() => setStatus(row.id, 'draft')} style={adminGhost}>
              <AppText>Taslağa al</AppText>
            </Pressable>
            <Pressable onPress={() => setStatus(row.id, 'archived')} style={adminGhost}>
              <AppText>Arşivle</AppText>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}
