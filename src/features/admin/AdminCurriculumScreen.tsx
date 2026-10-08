import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminGhost } from '@/src/features/admin/adminUi';
import { AdminDecomposeEditor } from '@/src/features/admin/AdminDecomposeEditor';
import { mapAdminError } from '@/src/features/admin/roles';
import { AdminCurriculumVersions } from '@/src/features/admin/AdminCurriculumVersions';
import { listCanonicalTopicMeta, runCurriculumDecompose } from '@/src/features/curriculum/decomposeApi';
import type { CanonicalTopicMeta, DecompositionProposal } from '@/src/features/curriculum/decomposeTypes';
import {
  useActiveCurriculumVersion,
  useCurriculumMutations,
  useExamCatalog,
  useSubjectCatalog,
  useTopicCatalog,
  useUnitCatalog,
} from '@/src/features/curriculum/useCurriculum';

const field = {
  minHeight: 44,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  borderRadius: 12,
  paddingHorizontal: 12,
  backgroundColor: '#fff',
} as const;
const chip = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#E8E3D8' } as const;
const chipOn = { backgroundColor: '#F3E0D4' } as const;
const btn = {
  minHeight: 40,
  paddingHorizontal: 14,
  borderRadius: 12,
  backgroundColor: '#C45C26',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
const SAMPLE = `[
  {
    "exam": "KPSS Önlisans",
    "exam_code": "KPSS_ONLISANS",
    "subject": "Tarih",
    "unit": "İslamiyet Öncesi Türk Tarihi",
    "topics": [
      "Türklerin İlk Ana Yurdu",
      "Kut Anlayışı",
      "Kurultay",
      "Töre",
      "İkili Teşkilat",
      "Ordu-Millet Anlayışı"
    ]
  }
]`;

function Row({
  label,
  active,
  selected,
  onSelect,
  onToggle,
  onSaveName,
}: {
  label: string;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onSaveName: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label);
  return (
    <View style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EDE6D8' }}>
      <Pressable onPress={onSelect} style={[chip, selected && chipOn, { alignSelf: 'flex-start' }]}>
        <AppText>
          {label}
          {active ? '' : ' (pasif)'}
        </AppText>
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {editing ? (
          <>
            <TextInput value={name} onChangeText={setName} style={[field, { flex: 1, minWidth: 160 }]} />
            <Pressable
              onPress={() => {
                onSaveName(name);
                setEditing(false);
              }}
              style={btn}>
              <AppText tone="inverse">Kaydet</AppText>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => setEditing(true)}>
            <AppText tone="accent">Düzenle</AppText>
          </Pressable>
        )}
        <Pressable onPress={onToggle}>
          <AppText>{active ? 'Pasifleştir' : 'Aktifleştir'}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

export function AdminCurriculumScreen() {
  const queryClient = useQueryClient();
  const exams = useExamCatalog();
  const mutations = useCurriculumMutations();
  const [examId, setExamId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const subjects = useSubjectCatalog(examId);
  const units = useUnitCatalog(subjectId);
  const topics = useTopicCatalog(unitId);
  const [examName, setExamName] = useState('');
  const [examCode, setExamCode] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [unitName, setUnitName] = useState('');
  const [topicName, setTopicName] = useState('');
  const [bulk, setBulk] = useState(SAMPLE);
  const [summary, setSummary] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DecompositionProposal | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [topicMeta, setTopicMeta] = useState<CanonicalTopicMeta[]>([]);
  const active = useActiveCurriculumVersion(examId);

  const selectedExam = useMemo(() => (exams.data ?? []).find((row) => row.id === examId) ?? null, [examId, exams.data]);
  const selectedSubject = useMemo(
    () => (subjects.data ?? []).find((row) => row.id === subjectId) ?? null,
    [subjectId, subjects.data],
  );
  const selectedUnit = useMemo(() => (units.data ?? []).find((row) => row.id === unitId) ?? null, [unitId, units.data]);

  useEffect(() => {
    if (!selectedUnit?.canonical_unit_id) {
      setTopicMeta([]);
      return;
    }
    void listCanonicalTopicMeta(selectedUnit.canonical_unit_id).then(setTopicMeta).catch(() => setTopicMeta([]));
  }, [selectedUnit?.canonical_unit_id, proposal]);

  const metaFor = (canonicalId?: string | null) => topicMeta.find((row) => row.id === canonicalId) ?? null;

  const topicBadge = (canonicalId?: string | null) => {
    const meta = metaFor(canonicalId);
    if (!canonicalId || !meta || meta.analysis_status === 'unanalyzed') return '○ Analiz edilmedi';
    if (meta.too_broad && !meta.keep_single_override) return '⚠ Bölünmesi öneriliyor';
    return '✓';
  };

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Müfredat</AppText>
      <AppText tone="muted">
        Sınav → Ders → Ünite → Konu. Öğrenci yalnızca sınav seçer; güncel müfredat sürümü otomatik çözülür. Yıl
        iş kuralı değildir.
      </AppText>

      <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 16, gap: 10 }}>
        <AppText variant="subtitle">Toplu Müfredat İçe Aktar</AppText>
        <TextInput
          value={bulk}
          onChangeText={setBulk}
          multiline
          textAlignVertical="top"
          style={[field, { minHeight: 160, paddingVertical: 10 }, Platform.OS === 'web' ? { fontFamily: 'monospace' } : null]}
        />
        <Pressable
          onPress={() => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(bulk);
            } catch {
              toastError('JSON okunamadı.');
              return;
            }
            void mutations.importJson
              .mutateAsync(parsed)
              .then((result) => {
                const line = `Sınav +${result.exams_created} · Ders +${result.subjects_created} · Ünite +${result.units_created} · Konu +${result.topics_created} · atlanan ${result.skipped_duplicates}`;
                setSummary(line);
                toastSuccess('İçe aktarma tamam');
              })
              .catch(fail);
          }}
          style={[btn, mutations.importJson.isPending ? { opacity: 0.6 } : null]}>
          <AppText tone="inverse">{mutations.importJson.isPending ? 'Aktarılıyor…' : 'JSON içe aktar'}</AppText>
        </Pressable>
        {summary ? <AppText variant="caption">{summary}</AppText> : null}
      </View>

      <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 16, gap: 10 }}>
        <AppText variant="subtitle">Sınav</AppText>
        {(exams.data ?? []).map((row) => (
          <Row
            key={row.id}
            label={`${row.name} (${row.code})`}
            active={row.is_active}
            selected={row.id === examId}
            onSelect={() => {
              setExamId(row.id);
              setSubjectId(null);
              setUnitId(null);
            }}
            onToggle={() => void mutations.setActive.mutateAsync({ table: 'exam_catalog', id: row.id, isActive: !row.is_active }).catch(fail)}
            onSaveName={(name) => void mutations.rename.mutateAsync({ table: 'exam_catalog', id: row.id, name }).catch(fail)}
          />
        ))}
        <TextInput value={examName} onChangeText={setExamName} placeholder="Sınav adı" style={field} />
        <TextInput value={examCode} onChangeText={setExamCode} placeholder="Kod (örn. KPSS_ONLISANS)" autoCapitalize="characters" style={field} />
        <Pressable
          onPress={() => {
            void mutations.createExam
              .mutateAsync({ name: examName, code: examCode })
              .then(() => {
                setExamName('');
                setExamCode('');
                toastSuccess('Sınav eklendi');
              })
              .catch(fail);
          }}
          style={btn}>
          <AppText tone="inverse">Sınav ekle</AppText>
        </Pressable>
      </View>

      {selectedExam ? <AdminCurriculumVersions examId={selectedExam.id} examName={selectedExam.name} /> : null}

      {selectedExam ? (
        <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 16, gap: 10 }}>
          <AppText variant="subtitle">Ders · {selectedExam.name}</AppText>
          {(subjects.data ?? []).map((row) => (
            <Row
              key={row.id}
              label={row.name}
              active={row.is_active}
              selected={row.id === subjectId}
              onSelect={() => {
                setSubjectId(row.id);
                setUnitId(null);
              }}
              onToggle={() => void mutations.setActive.mutateAsync({ table: 'subject_catalog', id: row.id, isActive: !row.is_active }).catch(fail)}
              onSaveName={(name) => void mutations.rename.mutateAsync({ table: 'subject_catalog', id: row.id, name }).catch(fail)}
            />
          ))}
          <TextInput value={subjectName} onChangeText={setSubjectName} placeholder="Ders adı" style={field} />
          <Pressable
            onPress={() => {
              void mutations.createSubject
                .mutateAsync({ exam_id: selectedExam.id, name: subjectName })
                .then(() => {
                  setSubjectName('');
                  toastSuccess('Ders eklendi');
                })
                .catch(fail);
            }}
            style={btn}>
            <AppText tone="inverse">Ders ekle</AppText>
          </Pressable>
        </View>
      ) : null}

      {selectedSubject ? (
        <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 16, gap: 10 }}>
          <AppText variant="subtitle">Ünite · {selectedSubject.name}</AppText>
          {(units.data ?? []).map((row) => (
            <View key={row.id} style={{ gap: 8 }}>
              <Row
                label={row.name}
                active={row.is_active}
                selected={row.id === unitId}
                onSelect={() => setUnitId(row.id)}
                onToggle={() => void mutations.setActive.mutateAsync({ table: 'unit_catalog', id: row.id, isActive: !row.is_active }).catch(fail)}
                onSaveName={(name) => void mutations.rename.mutateAsync({ table: 'unit_catalog', id: row.id, name }).catch(fail)}
              />
              {row.id === unitId ? (
                <Pressable
                  disabled={analyzing}
                  onPress={() => {
                    setAnalyzing(true);
                    void runCurriculumDecompose({
                      mode: 'unit',
                      curriculum_version_id: active.data?.id ?? null,
                      subject_id: selectedSubject.id,
                      unit_id: row.id,
                    })
                      .then((result) => {
                        setProposal(result);
                        toastSuccess('Öneri taslağı hazır. Üretim kuyruğuna alınmadı.');
                      })
                      .catch(fail)
                      .finally(() => setAnalyzing(false));
                  }}
                  style={[adminBtn, analyzing ? { opacity: 0.6 } : null, { alignSelf: 'flex-start' }]}>
                  <AppText tone="inverse">{analyzing ? 'Müfredat analiz ediliyor...' : 'AI ile Konulara Böl'}</AppText>
                </Pressable>
              ) : null}
            </View>
          ))}
          <TextInput value={unitName} onChangeText={setUnitName} placeholder="Ünite adı" style={field} />
          <Pressable
            onPress={() => {
              void mutations.createUnit
                .mutateAsync({ subject_id: selectedSubject.id, name: unitName })
                .then(() => {
                  setUnitName('');
                  toastSuccess('Ünite eklendi');
                })
                .catch(fail);
            }}
            style={btn}>
            <AppText tone="inverse">Ünite ekle</AppText>
          </Pressable>
        </View>
      ) : null}

      {selectedUnit ? (
        <View style={{ backgroundColor: '#FFFcf7', borderRadius: 16, padding: 16, gap: 10 }}>
          <AppText variant="subtitle">Konu · {selectedUnit.name}</AppText>
          {(topics.data ?? []).map((row) => (
            <View key={row.id} style={{ gap: 6 }}>
              <Row
                label={`${topicBadge(row.canonical_topic_id)} ${row.name} · ${row.content_status}`}
                active={row.is_active}
                selected={false}
                onSelect={() => undefined}
                onToggle={() => void mutations.setActive.mutateAsync({ table: 'topic_catalog', id: row.id, isActive: !row.is_active }).catch(fail)}
                onSaveName={(name) => void mutations.rename.mutateAsync({ table: 'topic_catalog', id: row.id, name }).catch(fail)}
              />
              {row.canonical_topic_id ? (
                <Pressable
                  disabled={analyzing}
                  onPress={() => {
                    setAnalyzing(true);
                    void runCurriculumDecompose({
                      mode: 'topic',
                      canonical_topic_id: row.canonical_topic_id,
                      curriculum_version_id: active.data?.id ?? null,
                      subject_id: selectedSubject?.id ?? null,
                      unit_id: selectedUnit.id,
                    })
                      .then((result) => {
                        setProposal({
                          ...result,
                          exam_id: selectedExam?.id ?? result.exam_id,
                        });
                        toastSuccess('Ders yapısı taslağı hazır.');
                      })
                      .catch(fail)
                      .finally(() => setAnalyzing(false));
                  }}
                  style={[adminGhost, { alignSelf: 'flex-start' }]}>
                  <AppText variant="caption">{analyzing ? 'Müfredat analiz ediliyor...' : 'Ders Yapısını Analiz Et'}</AppText>
                </Pressable>
              ) : null}
            </View>
          ))}
          <TextInput value={topicName} onChangeText={setTopicName} placeholder="Konu adı" style={field} />
          <Pressable
            onPress={() => {
              void mutations.createTopic
                .mutateAsync({ unit_id: selectedUnit.id, name: topicName })
                .then(() => {
                  setTopicName('');
                  toastSuccess('Konu eklendi');
                })
                .catch(fail);
            }}
            style={btn}>
            <AppText tone="inverse">Konu ekle</AppText>
          </Pressable>
        </View>
      ) : null}

      {proposal ? (
        <AdminDecomposeEditor
          proposal={proposal}
          onClose={() => setProposal(null)}
          onApplied={() => {
            setProposal(null);
            void queryClient.invalidateQueries({ queryKey: ['topic-catalog'] });
            void queryClient.invalidateQueries({ queryKey: ['unit-catalog'] });
          }}
        />
      ) : null}
    </View>
  );
}
