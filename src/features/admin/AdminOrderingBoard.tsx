import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import {
  addTopicDependency,
  applyOrderingSuggestion,
  getUnitOrderingBoard,
  removeTopicDependency,
  setExamTopicSort,
  suggestCurriculumOrder,
  type OrderingBoard,
} from '@/src/features/curriculum/orderingApi';
import { wouldCreateHardCycle } from '@/src/features/curriculum/orderingGraph';

export function AdminOrderingBoard({ versionId, unitId }: { versionId: string; unitId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [depFrom, setDepFrom] = useState<string | null>(null);
  const [depTo, setDepTo] = useState<string | null>(null);
  const board = useQuery({
    queryKey: ['admin-ordering-board', versionId, unitId],
    queryFn: () => getUnitOrderingBoard(versionId, unitId),
  });
  const data: OrderingBoard | undefined = board.data;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-ordering-board', versionId, unitId] });
  };

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const move = async (index: number, dir: -1 | 1) => {
    const topics = data?.topics ?? [];
    const other = topics[index + dir];
    const current = topics[index];
    if (!current || !other) return;
    const edges = (data?.dependencies ?? []).map((row) => ({
      topicId: row.topic_id,
      dependsOnId: row.depends_on_topic_id,
      type: row.dependency_type as 'hard_prerequisite',
    }));
    const nodes = topics.map((row) => ({ id: row.canonical_topic_id, officialSort: row.official_sort }));
    const nextOfficial = topics.map((row, i) => {
      if (i === index) return { ...row, official_sort: other.official_sort };
      if (i === index + dir) return { ...row, official_sort: current.official_sort };
      return row;
    });
    const violated = edges.some((edge) => {
      if (edge.type !== 'hard_prerequisite') return false;
      const a = nextOfficial.find((row) => row.canonical_topic_id === edge.dependsOnId)?.official_sort ?? 0;
      const b = nextOfficial.find((row) => row.canonical_topic_id === edge.topicId)?.official_sort ?? 0;
      return a > b;
    });
    if (violated) {
      toastError('Bu taşıma zorunlu önkoşulu bozar. Önerilen sıra yine önkoşulu önce gösterir.');
    }
    setBusy(true);
    try {
      await setExamTopicSort(current.map_id, other.official_sort);
      await setExamTopicSort(other.map_id, current.official_sort);
      toastSuccess('Müfredat sırası güncellendi.');
      refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
    void nodes;
  };

  return (
    <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 16, gap: 10 }}>
      <AppText variant="subtitle">Öğrenme Sırası</AppText>
      <AppText variant="caption" tone="muted">
        Önerilen sıra önkoşulları korur. Yayınlanmış dersler yeniden üretilmez.
      </AppText>
      {board.isLoading ? <AppText tone="muted">Sıra yükleniyor…</AppText> : null}
      {(data?.topics ?? []).map((row, index) => (
        <View key={row.map_id} style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EDE6D8' }}>
          <AppText>
            {index + 1}. {row.topic_name}
          </AppText>
          <AppText variant="caption" tone="muted">
            Müfredat {row.official_sort} · Önerilen {row.recommended_rank ?? '—'} · Zorluk {row.difficulty_level}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable disabled={busy || index === 0} onPress={() => void move(index, -1)} style={adminGhost}>
              <AppText>Yukarı</AppText>
            </Pressable>
            <Pressable disabled={busy || index === (data?.topics.length ?? 0) - 1} onPress={() => void move(index, 1)} style={adminGhost}>
              <AppText>Aşağı</AppText>
            </Pressable>
            <Pressable onPress={() => setDepFrom(row.canonical_topic_id)} style={adminGhost}>
              <AppText>Bu konu…</AppText>
            </Pressable>
            <Pressable onPress={() => setDepTo(row.canonical_topic_id)} style={adminGhost}>
              <AppText>…şuna bağlı</AppText>
            </Pressable>
          </View>
        </View>
      ))}

      {(data?.dependencies ?? []).length ? <AppText variant="label">Bağımlılıklar</AppText> : null}
      {(data?.dependencies ?? []).map((row) => {
        const topic = data?.topics.find((item) => item.canonical_topic_id === row.topic_id)?.topic_name ?? row.topic_id;
        const dep = data?.topics.find((item) => item.canonical_topic_id === row.depends_on_topic_id)?.topic_name ?? row.depends_on_topic_id;
        return (
          <View key={row.id} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <AppText variant="caption">
              {topic} ← {row.dependency_type === 'hard_prerequisite' ? 'zorunlu' : 'önerilen'} {dep}
            </AppText>
            <Pressable onPress={() => void removeTopicDependency(row.id).then(refresh).catch(fail)}>
              <AppText tone="accent">Kaldır</AppText>
            </Pressable>
          </View>
        );
      })}

      {depFrom && depTo ? (
        <Pressable
          style={adminBtn}
          onPress={() => {
            const cycle = wouldCreateHardCycle(
              (data?.topics ?? []).map((row) => ({ id: row.canonical_topic_id, officialSort: row.official_sort })),
              (data?.dependencies ?? []).map((row) => ({
                topicId: row.topic_id,
                dependsOnId: row.depends_on_topic_id,
                type: row.dependency_type as 'hard_prerequisite',
              })),
              depFrom,
              depTo,
            );
            if (cycle) {
              toastError('Bu bağ çevrim oluşturur.');
              return;
            }
            void addTopicDependency({ topicId: depFrom, dependsOnId: depTo, type: 'hard_prerequisite' })
              .then(() => {
                toastSuccess('Önkoşul eklendi.');
                setDepFrom(null);
                setDepTo(null);
                refresh();
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : '';
                toastError(message.includes('CYCLE') ? 'Bu bağ çevrim oluşturur.' : mapAdminError(message));
              });
          }}>
          <AppText tone="inverse">Zorunlu önkoşul ekle</AppText>
        </Pressable>
      ) : (
        <AppText variant="caption" tone="muted">Önkoşul için önce bağımlı konuyu, sonra temel konuyu seç.</AppText>
      )}

      <Pressable
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void suggestCurriculumOrder({ curriculum_version_id: versionId, unit_id: unitId })
            .then((result) => {
              toastSuccess(`${result.created ?? 0} öneri taslak olarak geldi. Yayınlanan sıra değişmedi.`);
              refresh();
            })
            .catch(fail)
            .finally(() => setBusy(false));
        }}
        style={adminGhost}>
        <AppText>AI ile Sıralamayı Kontrol Et</AppText>
      </Pressable>

      {(data?.suggestions ?? []).map((row) => {
        const topic = data?.topics.find((item) => item.canonical_topic_id === row.topic_id)?.topic_name ?? 'Konu';
        const dep = data?.topics.find((item) => item.canonical_topic_id === row.depends_on_topic_id)?.topic_name ?? 'Önkoşul';
        return (
          <View key={row.id} style={{ gap: 6, paddingVertical: 8 }}>
            <AppText>
              {dep} → {topic} öneriliyor.
            </AppText>
            {row.reason ? <AppText variant="caption" tone="muted">{row.reason}</AppText> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                style={adminBtn}
                onPress={() =>
                  void applyOrderingSuggestion(row.id, true)
                    .then(() => {
                      toastSuccess('Öneri uygulandı.');
                      refresh();
                    })
                    .catch((error) => {
                      const message = error instanceof Error ? error.message : '';
                      toastError(message.includes('CYCLE') ? 'Çevrim nedeniyle uygulanamadı.' : mapAdminError(message));
                    })
                }>
                <AppText tone="inverse">Uygula</AppText>
              </Pressable>
              <Pressable
                style={adminGhost}
                onPress={() =>
                  void applyOrderingSuggestion(row.id, false)
                    .then(() => {
                      toastSuccess('Öneri reddedildi.');
                      refresh();
                    })
                    .catch(fail)
                }>
                <AppText>Reddet</AppText>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}
