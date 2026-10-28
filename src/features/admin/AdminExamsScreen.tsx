import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { AdminExamWizard } from '@/src/features/admin/AdminExamWizard';
import { adminBtn, adminCard, adminChip, adminChipOn, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { useAdminExams } from '@/src/features/admin/useAdmin';
import { useExamCatalog } from '@/src/features/curriculum/useCurriculum';
import { formatIstanbulDateTime } from '@/src/features/system-exams/examTime';
import { getSupabase } from '@/src/lib/supabase/client';

const STATUS_TR: Record<string, string> = {
  draft: 'Taslak',
  scheduled: 'Planlandı',
  live: 'Canlı',
  finished: 'Tamamlandı',
  cancelled: 'İptal',
};

type ExamRow = Record<string, unknown> & {
  id: string;
  title: string;
  status: string;
  start_at: string;
  duration_minutes: number;
  question_count: number;
};

function sectionOf(status: string) {
  if (status === 'live') return 'live';
  if (status === 'finished') return 'finished';
  if (status === 'cancelled') return 'cancelled';
  return 'upcoming';
}

export function AdminExamsScreen() {
  const exams = useAdminExams();
  const catalog = useExamCatalog();
  const [wizard, setWizard] = useState<ExamRow | null | undefined>(undefined);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<Record<string, unknown> | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [extendMins, setExtendMins] = useState('10');

  const groups = useMemo(() => {
    const rows = (exams.data ?? []) as ExamRow[];
    return {
      upcoming: rows.filter((row) => sectionOf(String(row.status)) === 'upcoming'),
      live: rows.filter((row) => sectionOf(String(row.status)) === 'live'),
      finished: rows.filter((row) => sectionOf(String(row.status)) === 'finished'),
      cancelled: rows.filter((row) => sectionOf(String(row.status)) === 'cancelled'),
    };
  }, [exams.data]);

  const fail = (error: unknown) => toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));

  const control = (id: string, action: string, minutes = 0) => {
    void getSupabase()
      .rpc('admin_exam_control', { p_exam: id, p_action: action, p_minutes: minutes })
      .then(({ error }) => {
        if (error) fail(error);
        else {
          toastSuccess('Güncellendi');
          void exams.refetch();
        }
      });
  };

  const openMonitor = (id: string) => {
    void getSupabase()
      .rpc('admin_exam_monitor', { p_exam: id })
      .then(({ data, error }) => {
        if (error) fail(error);
        else setMonitor(data as Record<string, unknown>);
      });
  };

  const openResults = (id: string) => {
    void getSupabase()
      .rpc('admin_exam_analytics', { p_exam: id })
      .then(({ data, error }) => {
        if (error) fail(error);
        else setAnalytics({ ...(data as object), exam_id: id });
      });
  };

  const renderCard = (exam: ExamRow) => {
    const when = formatIstanbulDateTime(String(exam.start_at));
    const status = String(exam.status);
    return (
      <View key={exam.id} style={adminCard}>
        <AppText variant="subtitle">{exam.title}</AppText>
        <AppText variant="caption" tone="muted">
          {when.label}
        </AppText>
        <AppText variant="caption">
          {exam.question_count} soru · {exam.duration_minutes} dakika
        </AppText>
        <View style={[adminChip, status === 'live' && adminChipOn, { alignSelf: 'flex-start' }]}>
          <AppText variant="caption">{STATUS_TR[status] ?? 'Planlandı'}</AppText>
        </View>
        {status === 'live' ? (
          <>
            <AppText>Katılan: {Number(exam.participant_count ?? 0)}</AppText>
            <AppText>Bitiren: {Number(exam.finished_count ?? 0)}</AppText>
            <Pressable onPress={() => openMonitor(exam.id)} style={adminBtn}>
              <AppText tone="inverse">Canlı İzle</AppText>
            </Pressable>
          </>
        ) : null}
        {status === 'finished' ? (
          <>
            <AppText>{Number(exam.participant_count ?? 0)} katılımcı</AppText>
            <AppText>Ortalama net: {exam.avg_net == null ? '—' : String(exam.avg_net)}</AppText>
            <Pressable onPress={() => openResults(exam.id)} style={adminBtn}>
              <AppText tone="inverse">Sonuçlar</AppText>
            </Pressable>
          </>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable onPress={() => setWizard(exam)} style={adminGhost}>
            <AppText>Düzenle</AppText>
          </Pressable>
          <Pressable onPress={() => setMenuId(menuId === exam.id ? null : exam.id)} style={adminGhost}>
            <AppText>⋯</AppText>
          </Pressable>
        </View>
        {menuId === exam.id ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {status === 'live' ? (
              <>
                <TextInput value={extendMins} onChangeText={setExtendMins} style={[adminField, { width: 72 }]} />
                <Pressable
                  onPress={() =>
                    askConfirm({
                      title: 'Süre uzatılsın mı?',
                      confirmLabel: 'Uzat',
                      onConfirm: () => control(exam.id, 'extend', Number(extendMins) || 10),
                    })
                  }
                  style={adminGhost}>
                  <AppText>Sınavı uzat</AppText>
                </Pressable>
                <Pressable
                  onPress={() =>
                    askConfirm({
                      title: 'Sınav erken bitsin mi?',
                      confirmLabel: 'Bitir',
                      danger: true,
                      onConfirm: () => control(exam.id, 'finish_early'),
                    })
                  }
                  style={adminGhost}>
                  <AppText>Erken bitir</AppText>
                </Pressable>
              </>
            ) : null}
            {status !== 'cancelled' && status !== 'finished' ? (
              <Pressable
                onPress={() =>
                  askConfirm({
                    title: 'Sınav iptal edilsin mi?',
                    confirmLabel: 'İptal et',
                    danger: true,
                    onConfirm: () => control(exam.id, 'cancel'),
                  })
                }
                style={adminGhost}>
                <AppText>İptal et</AppText>
              </Pressable>
            ) : null}
            {status === 'finished' ? (
              <Pressable onPress={() => control(exam.id, 'release')} style={adminGhost}>
                <AppText>Sonuçları Açıkla</AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
        <AppText variant="title">Sistem Sınavları</AppText>
        <Pressable onPress={() => setWizard(null)} style={adminBtn}>
          <AppText tone="inverse">+ Yeni Sınav</AppText>
        </Pressable>
      </View>

      {(exams.data ?? []).length === 0 && !exams.isLoading ? (
        <View style={adminCard}>
          <AppText>Henüz sistem sınavı oluşturulmamış.</AppText>
          <Pressable onPress={() => setWizard(null)} style={adminBtn}>
            <AppText tone="inverse">İlk sınavı oluştur</AppText>
          </Pressable>
        </View>
      ) : null}

      {groups.live.length ? (
        <>
          <AppText variant="label">CANLI</AppText>
          {groups.live.map(renderCard)}
        </>
      ) : null}
      {groups.upcoming.length ? (
        <>
          <AppText variant="label">YAKLAŞAN</AppText>
          {groups.upcoming.map(renderCard)}
        </>
      ) : null}
      {groups.finished.length ? (
        <>
          <AppText variant="label">TAMAMLANAN</AppText>
          {groups.finished.map(renderCard)}
        </>
      ) : null}
      {groups.cancelled.length ? (
        <>
          <AppText variant="label">İPTAL EDİLEN</AppText>
          {groups.cancelled.map(renderCard)}
        </>
      ) : null}

      {wizard !== undefined ? (
        <AdminExamWizard
          catalog={catalog.data ?? []}
          exam={wizard}
          onClose={() => setWizard(undefined)}
          onSaved={() => {
            setWizard(undefined);
            void exams.refetch();
          }}
        />
      ) : null}

      <Modal visible={Boolean(monitor)} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'center', padding: 16 }}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={[adminCard, { gap: 8 }]}>
            <AppText variant="title">Canlı izleme</AppText>
            <AppText>Katılan: {Number(monitor?.joined ?? 0)}</AppText>
            <AppText>Devam eden: {Number(monitor?.in_progress ?? 0)}</AppText>
            <AppText>Bitiren: {Number(monitor?.finished ?? 0)}</AppText>
            <AppText>Henüz başlamayan: {Number(monitor?.not_started ?? 0)}</AppText>
            {Array.isArray(monitor?.sessions)
              ? (monitor?.sessions as { id: string; name: string; status: string }[]).map((row) => (
                  <AppText key={row.id} variant="caption">
                    {row.name} · {row.status === 'in_progress' ? 'Devam' : 'Bitti'}
                  </AppText>
                ))
              : null}
            <Pressable onPress={() => setMonitor(null)} style={adminGhost}>
              <AppText>Kapat</AppText>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={Boolean(analytics)} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'center', padding: 16 }}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={[adminCard, { gap: 8 }]}>
            <AppText variant="title">Sonuçlar</AppText>
            <AppText>Katılımcı: {String(analytics?.participants ?? '—')}</AppText>
            <AppText>Ortalama net: {String(analytics?.avg_net ?? '—')}</AppText>
            <AppText>Ort. doğru / yanlış / boş: {String(analytics?.avg_correct ?? '—')} / {String(analytics?.avg_wrong ?? '—')} / {String(analytics?.avg_blank ?? '—')}</AppText>
            <AppText>Ort. süre: {String(analytics?.avg_minutes ?? '—')} dk</AppText>
            <AppText variant="label">Dersler</AppText>
            {Array.isArray(analytics?.subjects)
              ? (analytics?.subjects as { name: string; success: number }[]).map((row) => (
                  <AppText key={row.name} variant="caption">
                    {row.name} — %{row.success}
                  </AppText>
                ))
              : null}
            <AppText variant="label">En çok zorlanılan konular</AppText>
            {Array.isArray(analytics?.hard_topics)
              ? (analytics?.hard_topics as { name: string; success: number }[]).map((row) => (
                  <AppText key={row.name} variant="caption">
                    {row.name} — %{row.success}
                  </AppText>
                ))
              : null}
            <AppText variant="label">En çok yanlış yapılan sorular</AppText>
            {Array.isArray(analytics?.questions)
              ? (analytics?.questions as { id: string; stem: string; wrong_pct: number; correct_pct: number; blank_pct: number }[])
                  .slice(0, 8)
                  .map((row) => (
                    <AppText key={row.id} variant="caption">
                      %{row.wrong_pct} yanlış · {row.stem}
                    </AppText>
                  ))
              : null}
            <Pressable
              onPress={() => analytics?.exam_id && control(String(analytics.exam_id), 'release')}
              style={adminBtn}>
              <AppText tone="inverse">Sonuçları Açıkla</AppText>
            </Pressable>
            <Pressable onPress={() => setAnalytics(null)} style={adminGhost}>
              <AppText>Kapat</AppText>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
