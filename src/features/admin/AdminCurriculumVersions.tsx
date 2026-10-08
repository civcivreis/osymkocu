import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { mapAdminError } from '@/src/features/admin/roles';
import {
  useActiveCurriculumVersion,
  useCurriculumMutations,
  useCurriculumVersions,
  useExamTopicMap,
} from '@/src/features/curriculum/useCurriculum';
import type { CurriculumVersion } from '@/src/features/curriculum/types';

const field = {
  minHeight: 44,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  borderRadius: 12,
  paddingHorizontal: 12,
  backgroundColor: '#fff',
} as const;
const btn = {
  minHeight: 40,
  paddingHorizontal: 14,
  borderRadius: 12,
  backgroundColor: '#C45C26',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
const ghost = {
  minHeight: 36,
  paddingHorizontal: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: '#fff',
};

function statusLabel(status: string) {
  if (status === 'active') return 'ACTIVE';
  if (status === 'scheduled') return 'ZAMANLI';
  if (status === 'draft') return 'TASLAK';
  if (status === 'archived') return 'ARŞİV';
  return status;
}

export function AdminCurriculumVersions({ examId, examName }: { examId: string; examName: string }) {
  const versions = useCurriculumVersions(examId);
  const active = useActiveCurriculumVersion(examId);
  const mutations = useCurriculumMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(`Güncel ${examName} Müfredatı`);
  const [code, setCode] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [mappingOpen, setMappingOpen] = useState(false);
  const selected = useMemo(
    () => (versions.data ?? []).find((row) => row.id === selectedId) ?? null,
    [selectedId, versions.data],
  );
  const maps = useExamTopicMap(mappingOpen ? selectedId : null);

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const run = (fn: Promise<unknown>, ok: string) => {
    void fn.then(() => toastSuccess(ok)).catch(fail);
  };

  return (
    <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 16, gap: 10 }}>
      <AppText variant="subtitle">Müfredat sürümü · {examName}</AppText>
      <AppText>
        Güncel müfredat:{' '}
        {active.data?.name ?? 'Güncel müfredat henüz tanımlanmadı.'}
        {active.data?.revision_label ? ` · ${active.data.revision_label}` : ''}
      </AppText>
      <AppText variant="caption" tone="muted">
        Öğrenci yılı seçmez. Çözümleyici: manuel aktif → tarih penceresi → varsayılan → son sürüm.
      </AppText>

      {(versions.data ?? []).map((row: CurriculumVersion) => (
        <View key={row.id} style={{ gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EDE6D8' }}>
          <Pressable onPress={() => setSelectedId(row.id)}>
            <AppText>
              {row.name} ({row.code}) · {statusLabel(row.status)}
              {row.manually_activated ? ' · manuel' : ''}
              {row.is_default ? ' · varsayılan' : ''}
              {selectedId === row.id ? ' · seçili' : ''}
            </AppText>
          </Pressable>
          <AppText variant="caption" tone="muted">
            {row.effective_from || row.effective_until
              ? `Geçerlilik: ${row.effective_from ?? '…'} → ${row.effective_until ?? 'süresiz'}`
              : 'Tarih penceresi yok'}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable onPress={() => run(mutations.activateVersion.mutateAsync(row.id), 'Aktif yapıldı')} style={ghost}>
              <AppText>Aktif Yap</AppText>
            </Pressable>
            <Pressable
              onPress={() =>
                run(
                  mutations.scheduleVersion.mutateAsync({
                    id: row.id,
                    from: from.trim() || null,
                    until: until.trim() || null,
                  }),
                  'Zamanlandı',
                )
              }
              style={ghost}>
              <AppText>Zamanla</AppText>
            </Pressable>
            <Pressable onPress={() => run(mutations.duplicateVersion.mutateAsync(row.id), 'Kopyalandı')} style={ghost}>
              <AppText>Kopyala</AppText>
            </Pressable>
            <Pressable
              onPress={() => {
                setSelectedId(row.id);
                setMappingOpen(true);
              }}
              style={ghost}>
              <AppText>Eşlemeyi Düzenle</AppText>
            </Pressable>
            <Pressable onPress={() => run(mutations.archiveVersion.mutateAsync(row.id), 'Arşivlendi')} style={ghost}>
              <AppText>Arşivle</AppText>
            </Pressable>
          </View>
        </View>
      ))}

      <AppText variant="caption">Yeni / zamanlama tarihleri (YYYY-AA-GG, isteğe bağlı)</AppText>
      <TextInput value={from} onChangeText={setFrom} placeholder="effective_from" style={field} />
      <TextInput value={until} onChangeText={setUntil} placeholder="effective_until" style={field} />
      <TextInput value={name} onChangeText={setName} placeholder="Sürüm adı" style={field} />
      <TextInput value={code} onChangeText={setCode} placeholder="Kod (örn. KPSS_ONLISANS_CURRENT)" autoCapitalize="characters" style={field} />
      <Pressable
        onPress={() => {
          if (!name.trim()) {
            toastError('Sürüm adı gerekli.');
            return;
          }
          run(
            mutations.createVersion.mutateAsync({ exam_id: examId, name: name.trim(), code: code.trim() }),
            'Sürüm oluşturuldu',
          );
        }}
        style={btn}>
        <AppText tone="inverse">Yeni Sürüm</AppText>
      </Pressable>
      {selected ? (
        <AppText variant="caption" tone="muted">
          Seçili: {selected.name} · {statusLabel(selected.status)}
        </AppText>
      ) : null}

      {mappingOpen && selectedId ? (
        <View style={{ gap: 6 }}>
          <AppText variant="subtitle">Konu eşlemesi</AppText>
          <AppText variant="caption" tone="muted">
            {(maps.data ?? []).length} konu. Yeni sürüm kopyalayınca eşlemeler gelir; eski kayıtlar silinmez.
          </AppText>
          {(maps.data ?? []).map((row) => (
            <AppText key={row.id} variant="caption">
              {row.coverage_mode} · {row.depth_level} · sıra {row.sort_order}
              {row.included ? '' : ' (hariç)'}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}
