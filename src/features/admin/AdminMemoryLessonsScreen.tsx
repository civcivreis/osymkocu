import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { AdminNewLessonModal } from '@/src/features/admin/AdminNewLessonModal';
import { adminBtn, adminCard, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { testLessonStorage } from '@/src/features/memory-lessons/memoryLessonApi';
import {
  useAdminMemoryLessons,
  useGenerateMemoryLesson,
  useGenerateMemoryLessonMedia,
  usePublishMemoryLesson,
} from '@/src/features/memory-lessons/useMemoryLessons';
import type { MemoryLesson } from '@/src/features/memory-lessons/types';

function statusLabel(status: string) {
  if (status === 'draft') return 'Taslak';
  if (status === 'generating') return 'Üretiliyor';
  if (status === 'pending_validation') return 'Onay Bekliyor';
  if (status === 'approved') return 'Onaylı';
  if (status === 'published') return 'Yayında';
  if (status === 'archived') return 'Arşiv';
  return status;
}

function scopeLabel(scope?: string | null) {
  if (scope === 'exam_specific') return 'Exam Specific';
  if (scope === 'exam_extension') return 'Exam Extension';
  return 'Core';
}

function mediaLabel(status?: string | null) {
  if (status === 'ready') return 'Hazır';
  if (status === 'failed') return 'Hata';
  if (status === 'generating') return 'Üretiliyor';
  return 'Eksik';
}

export function AdminMemoryLessonsScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const list = useAdminMemoryLessons();
  const generate = useGenerateMemoryLesson();
  const generateMedia = useGenerateMemoryLessonMedia();
  const publish = usePublishMemoryLesson();
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [r2Busy, setR2Busy] = useState(false);
  const [r2Message, setR2Message] = useState<string | null>(null);
  const rows = list.data ?? [];

  const counts = useMemo(() => {
    return {
      draft: rows.filter((row) => row.status === 'draft').length,
      generating: rows.filter((row) => row.status === 'generating' || row.generation_status === 'generating').length,
      pending: rows.filter((row) => row.status === 'pending_validation').length,
      published: rows.filter((row) => row.status === 'published').length,
    };
  }, [rows]);

  const runR2Test = () => {
    setR2Busy(true);
    setR2Message(null);
    void testLessonStorage()
      .then((result) => {
        const extra = result.cleaned ? ' Test dosyası silindi.' : '';
        setR2Message(`R2 bağlantısı başarılı · ${result.key}${extra}`);
        toastSuccess('R2 bağlantısı başarılı');
      })
      .catch((error: unknown) => {
        toastError(error instanceof Error ? error.message : 'R2 bağlantısı doğrulanamadı.');
      })
      .finally(() => setR2Busy(false));
  };

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const withBusy = (id: string, fn: Promise<unknown>, ok: string) => {
    setBusyId(id);
    void fn
      .then(() => toastSuccess(ok))
      .catch(fail)
      .finally(() => setBusyId(null));
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 4 }}>
          <AppText variant="title">Hafıza Dersleri</AppText>
          <AppText tone="muted">Ders üretim panosu</AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable onPress={() => setModalOpen(true)} style={adminBtn}>
            <AppText tone="inverse">+ Yeni Ders</AppText>
          </Pressable>
          <Pressable onPress={() => router.push('/admin/mufredat' as never)} style={adminGhost}>
            <AppText>Müfredatı Yönet</AppText>
          </Pressable>
          <Pressable onPress={runR2Test} disabled={r2Busy} style={[adminGhost, r2Busy ? { opacity: 0.6 } : null]}>
            <AppText>{r2Busy ? 'Test ediliyor…' : 'R2 Bağlantısını Test Et'}</AppText>
          </Pressable>
        </View>
      </View>
      {r2Message ? <AppText variant="caption">{r2Message}</AppText> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {[
          ['Taslak', counts.draft],
          ['Üretiliyor', counts.generating],
          ['Onay Bekliyor', counts.pending],
          ['Yayında', counts.published],
        ].map(([label, value]) => (
          <View key={String(label)} style={[adminCard, { minWidth: compact ? '46%' : 160, flexGrow: 1 }]}>
            <AppText variant="caption" tone="muted">
              {label}
            </AppText>
            <AppText variant="title">{value}</AppText>
          </View>
        ))}
      </View>

      {list.isError ? (
        <AppText tone="danger">{list.error instanceof Error ? list.error.message : 'Liste alınamadı.'}</AppText>
      ) : null}

      {!compact ? (
        <View style={[adminCard, { flexDirection: 'row', gap: 8 }]}>
          {['Ders', 'Sınav', 'Ders / Konu', 'Scope', 'Pedagogy Score', 'Media Status', 'Status', 'Updated', 'Actions'].map((col) => (
            <AppText key={col} variant="caption" tone="muted" style={{ flex: col === 'Ders' || col === 'Actions' ? 1.4 : 1 }}>
              {col}
            </AppText>
          ))}
        </View>
      ) : null}

      {rows.map((row) => (
        <LessonRow
          key={row.id}
          row={row}
          compact={compact}
          busy={busyId === row.id}
          onEdit={() => router.push(`/admin/hafiza-dersleri/${row.id}` as never)}
          onPreview={() => router.push(`/admin/hafiza-dersleri/${row.id}?tab=onizleme` as never)}
          onGenerate={() => withBusy(row.id, generate.mutateAsync(row.id), 'İçerik üretildi')}
          onMedia={() =>
            withBusy(row.id, generateMedia.mutateAsync({ lessonId: row.id, mode: 'missing' }), 'Medya üretildi')
          }
          onPublish={() => withBusy(row.id, publish.mutateAsync(row.id), 'Yayınlandı')}
        />
      ))}

      {!list.isLoading && rows.length === 0 ? <AppText tone="muted">Henüz hafıza dersi yok.</AppText> : null}
      <AdminNewLessonModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </View>
  );
}

function LessonRow({
  row,
  compact,
  busy,
  onEdit,
  onPreview,
  onGenerate,
  onMedia,
  onPublish,
}: {
  row: MemoryLesson;
  compact: boolean;
  busy: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onGenerate: () => void;
  onMedia: () => void;
  onPublish: () => void;
}) {
  const actions = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1.4 }}>
      <Pressable onPress={onEdit} style={adminGhost}>
        <AppText variant="caption">Düzenle</AppText>
      </Pressable>
      <Pressable onPress={onPreview} style={adminGhost}>
        <AppText variant="caption">Önizle</AppText>
      </Pressable>
      <Pressable disabled={busy || row.status === 'published'} onPress={onGenerate} style={[adminGhost, busy ? { opacity: 0.6 } : null]}>
        <AppText variant="caption">İçerik Üret</AppText>
      </Pressable>
      <Pressable disabled={busy} onPress={onMedia} style={[adminGhost, busy ? { opacity: 0.6 } : null]}>
        <AppText variant="caption">Medya Üret</AppText>
      </Pressable>
      <Pressable disabled={busy || row.status !== 'approved'} onPress={onPublish} style={[adminGhost, busy ? { opacity: 0.6 } : null]}>
        <AppText variant="caption">Yayınla</AppText>
      </Pressable>
    </View>
  );

  if (compact) {
    return (
      <View style={adminCard}>
        <AppText variant="subtitle">{row.title}</AppText>
        <AppText variant="caption" tone="muted">
          {String(row.exam_type).toUpperCase()} · {row.subject} / {row.topic} · {scopeLabel(row.lesson_scope)}
        </AppText>
        <AppText variant="caption" tone="muted">
          Pedagoji {typeof row.pedagogy_score === 'number' ? row.pedagogy_score : '—'} · Medya {mediaLabel(row.media_generation_status)} ·{' '}
          {statusLabel(row.status)} · {String(row.updated_at ?? row.created_at).slice(0, 10)}
        </AppText>
        {actions}
      </View>
    );
  }

  return (
    <View style={[adminCard, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
      <AppText style={{ flex: 1.4 }}>{row.title}</AppText>
      <AppText variant="caption" style={{ flex: 1 }}>
        {String(row.exam_type).toUpperCase()}
      </AppText>
      <AppText variant="caption" style={{ flex: 1 }}>
        {row.subject} / {row.topic}
      </AppText>
      <AppText variant="caption" style={{ flex: 1 }}>
        {scopeLabel(row.lesson_scope)}
      </AppText>
      <AppText variant="caption" style={{ flex: 1 }}>
        {typeof row.pedagogy_score === 'number' ? String(row.pedagogy_score) : '—'}
      </AppText>
      <AppText variant="caption" style={{ flex: 1 }}>
        {mediaLabel(row.media_generation_status)}
      </AppText>
      <AppText variant="caption" style={{ flex: 1 }}>
        {statusLabel(row.status)}
      </AppText>
      <AppText variant="caption" style={{ flex: 1 }}>
        {String(row.updated_at ?? row.created_at).slice(0, 10)}
      </AppText>
      {actions}
    </View>
  );
}
