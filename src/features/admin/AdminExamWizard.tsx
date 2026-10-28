import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { useAdminUpsertExam } from '@/src/features/admin/useAdmin';
import { listSubjectCatalog, listTopicCatalog, listUnitCatalog } from '@/src/features/curriculum/curriculumApi';
import type { ExamCatalog, SubjectCatalog } from '@/src/features/curriculum/types';
import { DEFAULT_EXAM_SLOT, EXAM_TIME_SLOTS, buildIstanbulStart, defaultDuration } from '@/src/features/system-exams/examTime';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { getSupabase } from '@/src/lib/supabase/client';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';

type DistTopic = { name: string; count: number };
type DistRow = { subjectId?: string; subject: string; count: number; topics: DistTopic[] };
type PoolRow = {
  id: string;
  stem: string;
  subject: string;
  topic: string;
  difficulty: string;
  question_status: string;
  source_type?: string;
  has_explanation?: boolean;
};

const STEPS = ['Bilgiler', 'Dağılım', 'Sorular', 'Önizleme'];
const DIFF_TR: Record<string, string> = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };

function familyOf(code: string): 'tyt' | 'ayt' | 'kpss' {
  if (code === 'AYT') return 'ayt';
  if (code === 'TYT') return 'tyt';
  return 'kpss';
}

const KPSS_TEMPLATE: Record<string, number> = {
  Türkçe: 30,
  Matematik: 30,
  Tarih: 27,
  Coğrafya: 18,
  Vatandaşlık: 9,
  'Güncel Bilgiler': 6,
};

function expectedTotal(code: string) {
  if (code.startsWith('KPSS') || code === 'TYT') return 120;
  if (code === 'AYT') return 80;
  return 120;
}

function defaultCounts(code: string, subjects: SubjectCatalog[]): DistRow[] {
  return subjects.map((subject) => ({
    subjectId: subject.id,
    subject: subject.name,
    count: code.startsWith('KPSS') ? KPSS_TEMPLATE[subject.name] ?? 0 : 0,
    topics: [],
  }));
}

function applyTemplate(code: string, rows: DistRow[]): DistRow[] {
  if (!code.startsWith('KPSS')) return rows;
  return rows.map((row) => ({ ...row, count: KPSS_TEMPLATE[row.subject] ?? row.count }));
}

function parseDist(raw: unknown): DistRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as DistRow;
    return {
      subjectId: row.subjectId,
      subject: String(row.subject ?? ''),
      count: Number(row.count) || 0,
      topics: Array.isArray(row.topics)
        ? row.topics.map((topic) => ({ name: String(topic.name ?? ''), count: Number(topic.count) || 0 }))
        : [],
    };
  }).filter((row) => row.subject);
}

export function AdminExamWizard({
  catalog,
  exam,
  onClose,
  onSaved,
}: {
  catalog: ExamCatalog[];
  exam?: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useAdminUpsertExam();
  const { width, isDesktop } = useBreakpoint();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(String(exam?.title ?? ''));
  const [description, setDescription] = useState(String(exam?.description ?? ''));
  const [catalogId, setCatalogId] = useState<string | null>((exam?.exam_catalog_id as string) ?? null);
  const [date, setDate] = useState(todayIsoIstanbul());
  const [slot, setSlot] = useState(DEFAULT_EXAM_SLOT);
  const [duration, setDuration] = useState(String(exam?.duration_minutes ?? 130));
  const [release, setRelease] = useState(String(exam?.result_release_mode ?? 'immediate'));
  const [releaseAt, setReleaseAt] = useState('');
  const [openAccess, setOpenAccess] = useState(String(exam?.participation_mode ?? 'open') !== 'invite');
  const [orderMode, setOrderMode] = useState(String(exam?.question_order_mode ?? 'grouped'));
  const [dist, setDist] = useState<DistRow[]>(() => parseDist(exam?.distribution));
  const [detailSubject, setDetailSubject] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pool, setPool] = useState<PoolRow[]>([]);
  const [search, setSearch] = useState('');
  const [missing, setMissing] = useState<{ path: string; need: number; have: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const selectedExam = catalog.find((row) => row.id === catalogId) ?? null;
  const family = familyOf(selectedExam?.code ?? 'KPSS');
  const totalNeed = dist.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const targetTotal = expectedTotal(selectedExam?.code ?? 'KPSS');
  const missingTotal = targetTotal - totalNeed;
  const gridCols = width >= 980 ? 3 : width >= 640 ? 2 : 1;
  const cardWidth: `${number}%` = gridCols === 3 ? '33.33%' : gridCols === 2 ? '50%' : '100%';

  useEffect(() => {
    if (!catalogId) return;
    const code = selectedExam?.code ?? '';
    void listSubjectCatalog(catalogId).then((rows) => {
      setDist((cur) => {
        if (!cur.length) return defaultCounts(code, rows);
        return rows.map((subject) => {
          const existing = cur.find((item) => item.subjectId === subject.id || item.subject === subject.name);
          return {
            subjectId: subject.id,
            subject: subject.name,
            count: existing?.count ?? (code.startsWith('KPSS') ? KPSS_TEMPLATE[subject.name] ?? 0 : 0),
            topics: existing?.topics ?? [],
          };
        });
      });
      setDuration((cur) => (exam?.duration_minutes ? String(exam.duration_minutes) : String(defaultDuration(family))));
    });
  }, [catalogId]);

  const loadPool = () => {
    void getSupabase()
      .rpc('admin_exam_question_pool', {
        p_exam_catalog_id: catalogId,
        p_search: search,
        p_subject: null,
        p_topic: null,
        p_difficulty: null,
        p_limit: 120,
      })
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else setPool((data as PoolRow[]) ?? []);
      });
  };

  useEffect(() => {
    if (step === 2 && catalogId) loadPool();
  }, [step, catalogId]);

  const autoPick = () => {
    setBusy(true);
    void getSupabase()
      .rpc('admin_auto_pick_exam_questions', {
        p_exam_catalog_id: catalogId,
        p_plan: dist.map((row) => ({
          subject: row.subject,
          count: row.count,
          topics: row.topics.filter((item) => item.count > 0),
        })),
      })
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else {
          const ids = ((data as { question_ids?: string[] })?.question_ids ?? []).filter(Boolean);
          setPicked([...new Set(ids)]);
          setMissing(((data as { missing?: typeof missing }).missing ?? []) as typeof missing);
        }
        setBusy(false);
      });
  };

  const persist = (status: 'draft' | 'scheduled') => {
    if (!title.trim() || !catalogId) {
      toastError('Başlık ve sınav türü gerekli.');
      return;
    }
    if (new Set(picked).size !== picked.length) {
      toastError('Aynı soru iki kez seçilemez.');
      return;
    }
    setBusy(true);
    void save
      .mutateAsync({
        id: exam?.id ?? null,
        title: title.trim(),
        description,
        exam_type: family,
        exam_catalog_id: catalogId,
        start_at: buildIstanbulStart(date, slot),
        duration_minutes: Number(duration) || defaultDuration(family),
        status,
        result_release_mode: release,
        result_release_at: release === 'scheduled' && releaseAt ? `${releaseAt}:00+03:00` : null,
        question_order_mode: orderMode,
        participation_mode: openAccess ? 'open' : 'invite',
        distribution: dist.map((row) => ({
          subject: row.subject,
          count: row.count,
          topics: row.topics.filter((item) => item.name.trim() && item.count > 0),
        })),
        question_ids: String(exam?.status) === 'live' || String(exam?.status) === 'finished' ? undefined : picked,
      })
      .then(
        () => {
          toastSuccess(status === 'draft' ? 'Taslak kaydedildi' : 'Sınav planlandı');
          onSaved();
        },
        (error: unknown) => toastError(error instanceof Error ? error.message : 'Kayıt başarısız'),
      )
      .then(() => setBusy(false));
  };

  const unpublished = pool.filter((row) => picked.includes(row.id) && row.question_status !== 'published').length;
  const noExplain = pool.filter((row) => picked.includes(row.id) && !row.has_explanation).length;
  const subjectCounts = useMemo(() => {
    const map: Record<string, number> = {};
    picked.forEach((id) => {
      const row = pool.find((item) => item.id === id);
      const key = row?.subject ?? 'Diğer';
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [picked, pool]);

  return (
    <Modal visible animationType="slide" transparent>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', padding: 12, justifyContent: 'center' }}>
        <View style={[adminCard, { height: '94%', maxWidth: 1080, width: '100%', alignSelf: 'center', padding: 0, overflow: 'hidden', gap: 0 }]}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          <AppText variant="title">{exam ? 'Sınavı düzenle' : 'Yeni sınav'}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {STEPS.map((label, index) => (
              <Pressable key={label} onPress={() => setStep(index)} style={[adminChip, step === index && adminChipOn]}>
                <AppText variant="caption">
                  {index + 1} {label}
                </AppText>
              </Pressable>
            ))}
          </View>

          {step === 0 ? (
            <View style={{ gap: 8 }}>
              <AppText variant="label">Sınav başlığı</AppText>
              <TextInput value={title} onChangeText={setTitle} placeholder="KPSS Genel Deneme #4" style={adminField} />
              <AppText variant="label">Açıklama</AppText>
              <TextInput value={description} onChangeText={setDescription} placeholder="İsteğe bağlı" style={[adminField, { minHeight: 72 }]} multiline />
              <AppText variant="label">Sınav türü</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {catalog.filter((row) => row.is_active).map((row) => (
                  <Pressable
                    key={row.id}
                    onPress={() => {
                      setCatalogId(row.id);
                      setDist([]);
                    }}
                    style={[adminChip, catalogId === row.id && adminChipOn]}>
                    <AppText>{row.name}</AppText>
                  </Pressable>
                ))}
              </View>
              <AppText variant="label">Tarih (YYYY-AA-GG)</AppText>
              <TextInput value={date} onChangeText={setDate} placeholder="2026-10-28" style={adminField} />
              <AppText variant="label">Başlangıç saati</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {EXAM_TIME_SLOTS.map((item) => (
                  <Pressable key={item} onPress={() => setSlot(item)} style={[adminChip, slot === item && adminChipOn]}>
                    <AppText>{item}</AppText>
                  </Pressable>
                ))}
              </View>
              <AppText variant="label">Süre (dakika)</AppText>
              <TextInput value={duration} onChangeText={setDuration} keyboardType="number-pad" style={adminField} />
              <AppText variant="label">Sonuç açıklama</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[
                  ['immediate', 'Sınav biter bitmez'],
                  ['scheduled', 'Belirli tarihte'],
                  ['manual', 'Admin manuel açıklar'],
                ].map(([value, label]) => (
                  <Pressable key={value} onPress={() => setRelease(value)} style={[adminChip, release === value && adminChipOn]}>
                    <AppText>{label}</AppText>
                  </Pressable>
                ))}
              </View>
              {release === 'scheduled' ? (
                <>
                  <AppText variant="label">Açıklama zamanı (YYYY-AA-GG SS:DD)</AppText>
                  <TextInput value={releaseAt} onChangeText={setReleaseAt} placeholder="2026-10-28 23:00" style={adminField} />
                </>
              ) : null}
              <AppText variant="label">Katılım</AppText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => setOpenAccess(true)} style={[adminChip, openAccess && adminChipOn]}>
                  <AppText>Herkese açık</AppText>
                </Pressable>
                <Pressable onPress={() => setOpenAccess(false)} style={[adminChip, !openAccess && adminChipOn]}>
                  <AppText>Seçili kullanıcılar</AppText>
                </Pressable>
              </View>
              <AppText variant="label">Soru sırası</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[
                  ['manual', 'Manuel'],
                  ['grouped', 'Derse göre gruplu'],
                  ['random_per_user', 'Kullanıcıya göre rastgele'],
                ].map(([value, label]) => (
                  <Pressable key={value} onPress={() => setOrderMode(value)} style={[adminChip, orderMode === value && adminChipOn]}>
                    <AppText>{label}</AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {step === 1 ? (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <AppText variant="subtitle">Sınav planı</AppText>
                {(selectedExam?.code ?? '').startsWith('KPSS') ? (
                  <Pressable onPress={() => setDist((cur) => applyTemplate('KPSS', cur))} style={adminGhost}>
                    <AppText variant="caption">KPSS standart dağılımını uygula</AppText>
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 }}>
                {dist.map((row, index) => {
                  const idle = row.count <= 0;
                  return (
                    <View key={row.subject} style={{ width: cardWidth, padding: 5 }}>
                      <View
                        style={{
                          borderWidth: 1,
                          borderColor: '#E4DDD0',
                          borderRadius: 14,
                          padding: 12,
                          backgroundColor: idle ? '#F7F3EC' : '#fff',
                          opacity: idle ? 0.62 : 1,
                          gap: 6,
                          minHeight: 108,
                        }}>
                        <AppText variant="label" numberOfLines={1}>
                          {row.subject}
                        </AppText>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <TextInput
                            value={String(row.count)}
                            onChangeText={(value) =>
                              setDist((cur) =>
                                cur.map((item, i) => (i === index ? { ...item, count: Math.max(0, Number(value) || 0) } : item)),
                              )
                            }
                            keyboardType="number-pad"
                            style={[adminField, { width: 56, minHeight: 36, paddingVertical: 6, textAlign: 'center' }]}
                          />
                          <AppText variant="caption" tone="muted">
                            soru
                          </AppText>
                        </View>
                        <Pressable onPress={() => setDetailSubject(row.subject)} hitSlop={6} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
                          <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
                            {row.topics.filter((item) => item.name.trim() && item.count > 0).length
                              ? `Detay · ${row.topics.filter((item) => item.count > 0).length} konu`
                              : 'Detaylandır'}
                          </AppText>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {step === 2 ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <TextInput value={search} onChangeText={setSearch} placeholder="Soru veya konu ara" style={[adminField, { flex: 1, minWidth: 160 }]} />
                <Pressable onPress={loadPool} style={adminGhost}>
                  <AppText>Ara</AppText>
                </Pressable>
                <Pressable disabled={busy} onPress={autoPick} style={adminBtn}>
                  <AppText tone="inverse">Dağılıma Göre Otomatik Seç</AppText>
                </Pressable>
              </View>
              <AppText variant="caption">
                Seçilen {picked.length} / {totalNeed || '—'}
              </AppText>
              {dist.map((row) => (
                <AppText key={`sel-${row.subject}`} variant="caption">
                  {row.subject}: {subjectCounts[row.subject] ?? 0} / {row.count}
                </AppText>
              ))}
              {missing.map((row) => (
                <AppText key={row.path} tone="danger">
                  {row.path} için {row.need - row.have} soru eksik.
                </AppText>
              ))}
              {pool.map((row) => {
                const on = picked.includes(row.id);
                return (
                  <Pressable
                    key={row.id}
                    onPress={() =>
                      setPicked((cur) => (on ? cur.filter((id) => id !== row.id) : cur.includes(row.id) ? cur : [...cur, row.id]))
                    }
                    style={[adminGhost, { alignItems: 'flex-start' }]}>
                    <AppText>
                      {on ? '☑ ' : '☐ '}
                      {row.stem.slice(0, 140)}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {row.subject} · {row.topic} · {DIFF_TR[row.difficulty] ?? row.difficulty} · Yayında
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {step === 3 ? (
            <View style={{ gap: 8 }}>
              <AppText variant="subtitle">{title || 'Sınav'}</AppText>
              <AppText>
                {date} · {slot} · {duration} dk · {picked.length} soru
              </AppText>
              {dist.filter((row) => row.count > 0).map((row) => (
                <AppText key={`pv-${row.subject}`} variant="caption">
                  {row.subject} {row.count}
                </AppText>
              ))}
              <AppText>{picked.length === totalNeed && totalNeed > 0 ? '✓ Toplam soru sayısı doğru' : '! Soru sayısı dağılımla eşleşmiyor'}</AppText>
              <AppText>{new Set(picked).size === picked.length ? '✓ Tekrarlayan soru yok' : '! Aynı soru iki kez seçildi'}</AppText>
              <AppText>{unpublished === 0 ? '✓ Seçilen sorular yayında' : `! ${unpublished} soru yayında değil`}</AppText>
              <AppText>✓ Süre tanımlı</AppText>
              <AppText>✓ Başlangıç saati tanımlı</AppText>
              {noExplain ? <AppText>! {noExplain} sorunun açıklaması yok</AppText> : null}
            </View>
          ) : null}
        </ScrollView>

          {step === 1 ? (
            <View
              style={{
                padding: 12,
                borderTopWidth: 1,
                borderTopColor: '#E4DDD0',
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
                backgroundColor: '#FFFCF7',
              }}>
              <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
                <AppText variant="subtitle">
                  Toplam: {totalNeed} / {targetTotal} soru
                </AppText>
                <AppText variant="caption" tone={missingTotal === 0 && totalNeed > 0 ? 'accent' : 'muted'}>
                  {missingTotal === 0 && totalNeed > 0
                    ? '✓ Dağılım tamamlandı'
                    : missingTotal > 0
                      ? `! ${totalNeed} / ${targetTotal} — ${missingTotal} soru eksik`
                      : `! ${totalNeed} / ${targetTotal} — ${Math.abs(missingTotal)} soru fazla`}
                </AppText>
              </View>
              <Pressable onPress={onClose} style={adminGhost}>
                <AppText>Kapat</AppText>
              </Pressable>
              <Pressable onPress={() => setStep(0)} style={adminGhost}>
                <AppText>Geri</AppText>
              </Pressable>
              <Pressable onPress={() => setStep(2)} style={adminBtn}>
                <AppText tone="inverse">İleri</AppText>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', padding: 12, borderTopWidth: 1, borderTopColor: '#E4DDD0' }}>
              <Pressable onPress={onClose} style={adminGhost}>
                <AppText>Kapat</AppText>
              </Pressable>
              {step > 0 ? (
                <Pressable onPress={() => setStep((value) => value - 1)} style={adminGhost}>
                  <AppText>Geri</AppText>
                </Pressable>
              ) : null}
              {step < 3 ? (
                <Pressable onPress={() => setStep((value) => value + 1)} style={adminBtn}>
                  <AppText tone="inverse">İleri</AppText>
                </Pressable>
              ) : (
                <>
                  <Pressable disabled={busy} onPress={() => persist('draft')} style={adminGhost}>
                    <AppText>Taslak Kaydet</AppText>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => persist('scheduled')} style={adminBtn}>
                    <AppText tone="inverse">Planla / Yayınla</AppText>
                  </Pressable>
                </>
              )}
            </View>
          )}
        </View>
        <TopicDistDrawer
          visible={Boolean(detailSubject)}
          desktop={isDesktop}
          row={dist.find((item) => item.subject === detailSubject) ?? null}
          catalogId={catalogId}
          onClose={() => setDetailSubject(null)}
          onSave={(topics) => {
            setDist((cur) => cur.map((item) => (item.subject === detailSubject ? { ...item, topics } : item)));
            setDetailSubject(null);
          }}
        />
      </View>
    </Modal>
  );
}

type CurricPick = { unit: string; name: string; available: number };

function TopicDistDrawer({
  visible,
  desktop,
  row,
  catalogId,
  onClose,
  onSave,
}: {
  visible: boolean;
  desktop: boolean;
  row: DistRow | null;
  catalogId: string | null;
  onClose: () => void;
  onSave: (topics: DistTopic[]) => void;
}) {
  const [topics, setTopics] = useState<DistTopic[]>([]);
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [catalog, setCatalog] = useState<CurricPick[]>([]);

  useEffect(() => {
    if (!visible || !row) return;
    setTopics(row.topics.length ? row.topics.map((item) => ({ ...item })) : []);
    setPicker(false);
    setCustom(false);
    setCustomName('');
    void loadTopicChoices(row, catalogId).then(setCatalog);
  }, [visible, row?.subject, catalogId]);

  if (!visible || !row) return null;
  const used = topics.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const gap = row.count - used;

  return (
    <Modal visible transparent animationType={desktop ? 'fade' : 'slide'} onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(15,28,46,0.4)',
          justifyContent: desktop ? 'center' : 'flex-end',
          alignItems: desktop ? 'flex-end' : 'stretch',
        }}>
        <Pressable
          onPress={() => undefined}
          style={{
            width: desktop ? 440 : '100%',
            maxHeight: desktop ? '94%' : '88%',
            backgroundColor: '#FFFCF7',
            borderTopLeftRadius: 20,
            borderBottomLeftRadius: desktop ? 20 : 0,
            borderTopRightRadius: desktop ? 0 : 20,
            padding: 18,
            gap: 12,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="subtitle">
                {row.subject} · {row.count} soru
              </AppText>
              <AppText variant="caption" tone="muted">
                Konu dağılımı isteğe bağlı. 3. adımda soru seçebilirsin.
              </AppText>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <AppText variant="caption">Kapat</AppText>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: desktop ? 520 : 420 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            {topics.map((topic, index) => (
              <View key={`${topic.name}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <AppText style={{ flex: 1 }} numberOfLines={2}>
                  {topic.name || 'Konu'}
                </AppText>
                <TextInput
                  value={String(topic.count)}
                  onChangeText={(value) =>
                    setTopics((cur) => cur.map((item, i) => (i === index ? { ...item, count: Math.max(0, Number(value) || 0) } : item)))
                  }
                  keyboardType="number-pad"
                  style={[adminField, { width: 56, minHeight: 36, paddingVertical: 6, textAlign: 'center' }]}
                />
                <Pressable
                  onPress={() => setTopics((cur) => cur.filter((_, i) => i !== index))}
                  hitSlop={6}
                  style={{ paddingHorizontal: 4 }}>
                  <AppText variant="caption" tone="muted">
                    Sil
                  </AppText>
                </Pressable>
              </View>
            ))}

            {picker ? (
              <View style={{ gap: 6, paddingTop: 4 }}>
                <AppText variant="caption" tone="muted">
                  Müfredattan seç
                </AppText>
                {catalog.length === 0 ? (
                  <AppText variant="caption" tone="muted">
                    Bu ders için müfredat konusu yok.
                  </AppText>
                ) : (
                  catalog.map((item) => {
                    const on = topics.some((topic) => topic.name === item.name);
                    return (
                      <Pressable
                        key={`${item.unit}-${item.name}`}
                        disabled={on}
                        onPress={() => setTopics((cur) => [...cur, { name: item.name, count: 0 }])}
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: '#E4DDD0',
                          opacity: on ? 0.45 : 1,
                          gap: 2,
                        }}>
                        <AppText variant="caption" tone="muted">
                          {item.unit}
                        </AppText>
                        <AppText>{item.name}</AppText>
                        <AppText variant="caption" tone="muted">
                          Mevcut {item.available} soru
                        </AppText>
                      </Pressable>
                    );
                  })
                )}
                <Pressable onPress={() => setCustom(true)} style={{ paddingVertical: 8 }}>
                  <AppText variant="caption" tone="accent">
                    Özel başlık ekle
                  </AppText>
                </Pressable>
                {custom ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      value={customName}
                      onChangeText={setCustomName}
                      placeholder="Özel konu başlığı"
                      style={[adminField, { flex: 1 }]}
                    />
                    <Pressable
                      onPress={() => {
                        const name = customName.trim();
                        if (!name) return;
                        setTopics((cur) => [...cur, { name, count: 0 }]);
                        setCustomName('');
                        setCustom(false);
                      }}
                      style={adminBtn}>
                      <AppText tone="inverse" variant="caption">
                        Ekle
                      </AppText>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
              <Pressable onPress={() => setPicker(true)} style={[adminGhost, { alignSelf: 'flex-start' }]}>
                <AppText variant="caption">+ Konu Ekle</AppText>
              </Pressable>
            )}
          </ScrollView>

          <AppText variant="caption" tone={gap === 0 ? 'accent' : 'muted'}>
            Toplam: {used} / {row.count}
            {gap === 0 ? '' : gap > 0 ? ` — ${gap} konu dağıtılmadı` : ` — ${Math.abs(gap)} fazla`}
          </AppText>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={onClose} style={[adminGhost, { flex: 1 }]}>
              <AppText>Vazgeç</AppText>
            </Pressable>
            <Pressable
              onPress={() => onSave(topics.filter((item) => item.name.trim()))}
              style={[adminBtn, { flex: 1 }]}>
              <AppText tone="inverse">Kaydet</AppText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

async function loadTopicChoices(row: DistRow, catalogId: string | null): Promise<CurricPick[]> {
  const units = row.subjectId ? await listUnitCatalog(row.subjectId).catch(() => []) : [];
  const nested = await Promise.all(
    units.map(async (unit) => ({
      unit: unit.name,
      rows: await listTopicCatalog(unit.id).catch(() => []),
    })),
  );
  const topics: CurricPick[] = [];
  nested.forEach(({ unit, rows }) => {
    rows.forEach((topic) => topics.push({ unit, name: topic.name, available: 0 }));
  });
  const pool = await getSupabase().rpc('admin_exam_question_pool', {
    p_exam_catalog_id: catalogId,
    p_search: '',
    p_subject: row.subject,
    p_topic: null,
    p_difficulty: null,
    p_limit: 200,
  });
  const counts = new Map<string, number>();
  ((pool.data as { topic?: string }[]) ?? []).forEach((item) => {
    const name = item.topic ?? '';
    if (!name) return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  topics.forEach((item) => {
    item.available = counts.get(item.name) ?? 0;
  });
  counts.forEach((available, name) => {
    if (!topics.some((item) => item.name === name)) topics.push({ unit: row.subject, name, available });
  });
  return topics;
}
