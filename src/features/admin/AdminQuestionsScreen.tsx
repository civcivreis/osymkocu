import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminColors, adminField, adminGhost, mufredatHref } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import {
  getTopicQuestionSummary,
  listTopicQuestions,
  setQuestionStatus,
} from '@/src/features/questions/questionBankApi';
import {
  getQuestionBankTree,
  importQuestionPackage,
  listImportItems,
  listQuestionImports,
  previewStats,
  type BankExam,
  type BankTopic,
  type ImportBatch,
  type ImportResult,
} from '@/src/features/questions/questionImportApi';
import { parseQuestionPackageText, type ImportQuestionRow, type ParsedPackage } from '@/src/features/questions/questionPackageParse';
import { getSupabase } from '@/src/lib/supabase/client';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';

const emptyChoices = { A: '', B: '', C: '', D: '', E: '' };
const DIFF_TR: Record<string, string> = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };
const STATUS_TR: Record<string, string> = {
  draft: 'Taslak',
  published: 'Yayında',
  needs_review: 'İnceleme',
  approved: 'Onaylı',
  archived: 'Arşiv',
  generated: 'Aday',
};

type Editor = {
  id?: string;
  stem: string;
  choices: Record<string, string>;
  correct_choice: string;
  explanation: string;
  difficulty: string;
  question_status: string;
  source: string;
  exam_ids: string[];
};

export function AdminQuestionsScreen() {
  const { isDesktop, isTablet, isMobileWeb } = useBreakpoint();
  const [tree, setTree] = useState<BankExam[]>([]);
  const [examId, setExamId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [topic, setTopic] = useState<BankTopic | null>(null);
  const [openExams, setOpenExams] = useState<Record<string, boolean>>({});
  const [openSubjects, setOpenSubjects] = useState<Record<string, boolean>>({});
  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});
  const [treeOpen, setTreeOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [diffFilter, setDiffFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getTopicQuestionSummary>> | null>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listTopicQuestions>>>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [previewQ, setPreviewQ] = useState<(typeof rows)[number] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [historyItems, setHistoryItems] = useState<{ id: string; row_index: number; outcome: string; detail: string | null }[]>([]);
  const [pack, setPack] = useState<ParsedPackage | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTree = () => {
    void getQuestionBankTree()
      .then((data) => {
        setTree(data);
        if (!examId && data[0]) {
          setExamId(data[0].id);
          setOpenExams({ [data[0].id]: true });
        }
      })
      .catch((error) => toastError(mapAdminError(error instanceof Error ? error.message : 'Ağaç alınamadı.')));
  };

  useEffect(() => {
    loadTree();
  }, []);

  const refreshTopic = (node: BankTopic | null) => {
    if (!node?.canonical_topic_id) {
      setSummary(null);
      setRows([]);
      return;
    }
    void getTopicQuestionSummary(node.canonical_topic_id).then(setSummary).catch(() => setSummary(null));
    void listTopicQuestions(node.canonical_topic_id).then(setRows).catch(() => setRows([]));
  };

  useEffect(() => {
    refreshTopic(topic);
  }, [topic?.id, topic?.canonical_topic_id]);

  const fail = (error: unknown) => toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  const exam = tree.find((row) => row.id === examId) ?? null;
  const subject = exam?.subjects.find((row) => row.id === subjectId) ?? null;
  const unit = subject?.units.find((row) => row.id === unitId) ?? null;
  const preview = pack ? previewStats(pack.rows, tree) : null;
  const filtered = rows.filter((row) => {
    if (statusFilter && row.question_status !== statusFilter) return false;
    if (diffFilter && row.difficulty !== diffFilter) return false;
    if (sourceFilter && String(row.source_type ?? row.source ?? '') !== sourceFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLocaleLowerCase('tr');
      if (!`${row.stem} ${topic?.name ?? ''}`.toLocaleLowerCase('tr').includes(q)) return false;
    }
    return true;
  });

  const pickFile = () => {
    if (typeof document === 'undefined') {
      toastError('Paket yükleme web yöneticisinde.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.jsonl,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        try {
          const parsed = parseQuestionPackageText(text, file.name);
          setFileName(file.name);
          setPack(parsed);
          setResult(null);
          setImportOpen(true);
        } catch {
          toastError('Dosya okunamadı.');
        }
      });
    };
    input.click();
  };

  const applyImport = () => {
    if (!pack) return;
    setBusy(true);
    void importQuestionPackage({ fileName, pack, rows: pack.rows })
      .then((data) => {
        setResult(data);
        toastSuccess(`${data.imported} soru içe aktarıldı.`);
        loadTree();
        refreshTopic(topic);
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const openHistory = () => {
    setHistoryOpen(true);
    void listQuestionImports().then(setHistory).catch(fail);
  };

  const saveEditor = () => {
    if (!editor || !topic?.canonical_topic_id) return;
    void getSupabase()
      .rpc('admin_save_bank_question', {
        p_payload: {
          id: editor.id ?? null,
          canonical_topic_id: topic.canonical_topic_id,
          exam_catalog_id: examId,
          stem: editor.stem,
          choices: editor.choices,
          correct_choice: editor.correct_choice,
          explanation: editor.explanation,
          difficulty: editor.difficulty,
          question_status: editor.question_status,
          source: editor.source,
          exam_ids: editor.exam_ids,
        },
      })
      .then(({ error }) => {
        if (error) fail(error);
        else {
          toastSuccess('Kaydedildi');
          setEditor(null);
          refreshTopic(topic);
        }
      });
  };

  const treePanel = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 4 }}>
      {tree.map((item) => {
        const examOn = openExams[item.id];
        return (
          <View key={item.id}>
            <Pressable
              onPress={() => {
                setExamId(item.id);
                setSubjectId(null);
                setUnitId(null);
                setTopic(null);
                setOpenExams((cur) => ({ ...cur, [item.id]: !cur[item.id] }));
              }}
              style={{ paddingVertical: 8 }}>
              <AppText variant="label">
                {examOn ? '▾' : '▸'} {item.name}
              </AppText>
            </Pressable>
            {examOn
              ? item.subjects.map((subj) => {
                  const subOn = openSubjects[subj.id];
                  return (
                    <View key={subj.id} style={{ paddingLeft: 12 }}>
                      <Pressable
                        onPress={() => {
                          setExamId(item.id);
                          setSubjectId(subj.id);
                          setUnitId(null);
                          setTopic(null);
                          setOpenSubjects((cur) => ({ ...cur, [subj.id]: !cur[subj.id] }));
                        }}
                        style={{ paddingVertical: 6 }}>
                        <AppText>
                          {subOn ? '▾' : '▸'} {subj.name}
                          {subj.created_by_import ? ' · yeni' : ''}
                        </AppText>
                      </Pressable>
                      {subOn
                        ? subj.units.map((unt) => {
                            const unitOn = openUnits[unt.id];
                            return (
                              <View key={unt.id} style={{ paddingLeft: 12 }}>
                                <Pressable
                                  onPress={() => {
                                    setExamId(item.id);
                                    setSubjectId(subj.id);
                                    setUnitId(unt.id);
                                    setOpenUnits((cur) => ({ ...cur, [unt.id]: !cur[unt.id] }));
                                  }}
                                  style={{ paddingVertical: 6 }}>
                                  <AppText>
                                    {unitOn ? '▾' : '▸'} {unt.name}
                                    {unt.created_by_import ? ' · yeni' : ''}
                                  </AppText>
                                </Pressable>
                                {unitOn
                                  ? unt.topics.map((top) => (
                                      <Pressable
                                        key={top.id}
                                        onPress={() => {
                                          setExamId(item.id);
                                          setSubjectId(subj.id);
                                          setUnitId(unt.id);
                                          setTopic(top);
                                          setTreeOpen(false);
                                        }}
                                        style={{
                                          paddingVertical: 6,
                                          paddingLeft: 12,
                                          backgroundColor: topic?.id === top.id ? adminColors.accentSoft : 'transparent',
                                          borderRadius: 8,
                                          flexDirection: 'row',
                                          justifyContent: 'space-between',
                                          gap: 8,
                                        }}>
                                        <AppText>
                                          {top.name}
                                          {top.created_by_import ? ' · yeni' : ''}
                                        </AppText>
                                        <AppText variant="caption" tone="muted">
                                          {top.question_count ? top.question_count : '0 soru'}
                                        </AppText>
                                      </Pressable>
                                    ))
                                  : null}
                              </View>
                            );
                          })
                        : null}
                    </View>
                  );
                })
              : null}
          </View>
        );
      })}
    </ScrollView>
  );

  const filterBar = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <TextInput value={search} onChangeText={setSearch} placeholder="Soru veya konu ara" style={[adminField, { minWidth: 180, flex: 1 }]} />
      {[
        ['', 'Durum'],
        ['draft', 'Taslak'],
        ['published', 'Yayında'],
        ['needs_review', 'İnceleme'],
      ].map(([value, label]) => (
        <Pressable key={`st-${label}`} onPress={() => setStatusFilter(value)} style={[adminChip, statusFilter === value && adminChipOn]}>
          <AppText variant="caption">{label}</AppText>
        </Pressable>
      ))}
      {[
        ['', 'Zorluk'],
        ['easy', 'Kolay'],
        ['medium', 'Orta'],
        ['hard', 'Zor'],
      ].map(([value, label]) => (
        <Pressable key={`df-${label}`} onPress={() => setDiffFilter(value)} style={[adminChip, diffFilter === value && adminChipOn]}>
          <AppText variant="caption">{label}</AppText>
        </Pressable>
      ))}
      {[
        ['', 'Kaynak'],
        ['package_import', 'Paket'],
        ['manual', 'Manuel'],
      ].map(([value, label]) => (
        <Pressable key={`src-${label}`} onPress={() => setSourceFilter(value)} style={[adminChip, sourceFilter === value && adminChipOn]}>
          <AppText variant="caption">{label}</AppText>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={{ gap: 12, minHeight: 640 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <AppText variant="title">Soru Bankası</AppText>
          <AppText variant="caption" tone="muted">
            Müfredat ağacı · paket içe aktarım · otomatik yayın yok
          </AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {isMobileWeb ? (
            <Pressable onPress={() => setTreeOpen(true)} style={adminGhost}>
              <AppText>Müfredat</AppText>
            </Pressable>
          ) : null}
          <Pressable onPress={pickFile} style={adminBtn}>
            <AppText tone="inverse">Paket Yükle</AppText>
          </Pressable>
          <Pressable onPress={openHistory} style={adminGhost}>
            <AppText>İçe Aktarım Geçmişi</AppText>
          </Pressable>
          <Pressable
            onPress={() =>
              setEditor({
                stem: '',
                choices: { ...emptyChoices },
                correct_choice: 'A',
                explanation: '',
                difficulty: 'medium',
                question_status: 'draft',
                source: 'manuel',
                exam_ids: examId ? [examId] : [],
              })
            }
            style={adminGhost}>
            <AppText>Yeni Soru</AppText>
          </Pressable>
        </View>
      </View>

      {filterBar}

      <View style={{ flexDirection: isDesktop || isTablet ? 'row' : 'column', gap: 12, alignItems: 'stretch', minHeight: 560 }}>
        {isDesktop || isTablet ? (
          <View style={[{ width: isDesktop ? '28%' : '34%', maxWidth: 360 }, adminCard, { padding: 0, overflow: 'hidden' }]}>{treePanel}</View>
        ) : null}
        <View style={{ flex: 1, gap: 12 }}>
          {topic && summary ? (
            <View style={adminCard}>
              <AppText variant="subtitle">{topic.name}</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Stat label="Toplam" value={summary.total} />
                <Stat label="Kolay" value={summary.easy} />
                <Stat label="Orta" value={summary.medium} />
                <Stat label="Zor" value={summary.hard} />
                <Stat label="Yayında" value={summary.published} />
                <Stat label="Taslak" value={summary.draft ?? 0} />
                <Stat label="İnceleme" value={summary.needs_review} />
              </View>
              <AppText variant="caption" tone="muted">
                Sınavlar: {(summary.exam_codes ?? []).join(', ') || exam?.name || '—'}
              </AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Pressable
                  onPress={() =>
                    setEditor({
                      stem: '',
                      choices: { ...emptyChoices },
                      correct_choice: 'A',
                      explanation: '',
                      difficulty: 'medium',
                      question_status: 'draft',
                      source: 'manuel',
                      exam_ids: examId ? [examId] : [],
                    })
                  }
                  style={adminBtn}>
                  <AppText tone="inverse">Yeni Soru</AppText>
                </Pressable>
                <Pressable
                  onPress={() => router.push(mufredatHref(examId, subjectId, unitId) as never)}
                  style={adminGhost}>
                  <AppText>Konuyu Düzenle</AppText>
                </Pressable>
                <Pressable onPress={pickFile} style={adminGhost}>
                  <AppText>Paket Yükle</AppText>
                </Pressable>
              </View>
            </View>
          ) : topic && !topic.canonical_topic_id ? (
            <View style={adminCard}>
              <AppText>Bu konunun kanonik kaydı yok.</AppText>
            </View>
          ) : topic && summary && summary.total === 0 ? (
            <View style={adminCard}>
              <AppText>Bu konuya henüz soru eklenmemiş.</AppText>
            </View>
          ) : !topic ? (
            <View style={adminCard}>
              <AppText tone="muted">Soldan bir konu seç. Soru sayısı 0 olan konular da listelenir.</AppText>
            </View>
          ) : null}

          {topic && summary && summary.total === 0 ? (
            <View style={adminCard}>
              <AppText>Bu konuya henüz soru eklenmemiş.</AppText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={() =>
                    setEditor({
                      stem: '',
                      choices: { ...emptyChoices },
                      correct_choice: 'A',
                      explanation: '',
                      difficulty: 'medium',
                      question_status: 'draft',
                      source: 'manuel',
                      exam_ids: examId ? [examId] : [],
                    })
                  }
                  style={adminBtn}>
                  <AppText tone="inverse">Yeni Soru</AppText>
                </Pressable>
                <Pressable onPress={pickFile} style={adminGhost}>
                  <AppText>Paket Yükle</AppText>
                </Pressable>
              </View>
            </View>
          ) : null}

          {filtered.map((row) => (
            <View key={row.id} style={[adminCard, { paddingVertical: 12 }]}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText numberOfLines={2}>{row.stem}</AppText>
                  <AppText variant="caption" tone="muted">
                    {DIFF_TR[row.difficulty] ?? row.difficulty} · {STATUS_TR[row.question_status] ?? row.question_status} ·{' '}
                    {(row.exam_codes ?? []).join(', ') || exam?.code || '—'} · {row.package_name || row.source || row.source_type} ·{' '}
                    {String(row.updated_at ?? row.created_at ?? '').slice(0, 10)}
                  </AppText>
                </View>
                <Pressable onPress={() => setMenuId(menuId === row.id ? null : row.id)} style={adminGhost}>
                  <AppText>⋯</AppText>
                </Pressable>
              </View>
              {menuId === row.id ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Pressable
                    onPress={() =>
                      setEditor({
                        id: row.id,
                        stem: row.stem,
                        choices: { ...emptyChoices, ...(row.choices ?? {}) },
                        correct_choice: row.correct_choice ?? 'A',
                        explanation: row.explanation ?? '',
                        difficulty: row.difficulty,
                        question_status: row.question_status,
                        source: String(row.source ?? ''),
                        exam_ids: tree.filter((item) => (row.exam_codes ?? []).includes(item.code)).map((item) => item.id),
                      })
                    }
                    style={adminGhost}>
                    <AppText variant="caption">Düzenle</AppText>
                  </Pressable>
                  <Pressable onPress={() => setPreviewQ(row)} style={adminGhost}>
                    <AppText variant="caption">Önizle</AppText>
                  </Pressable>
                  <Pressable onPress={() => void setQuestionStatus(row.id, 'published').then(() => refreshTopic(topic)).catch(fail)} style={adminGhost}>
                    <AppText variant="caption">Yayınla</AppText>
                  </Pressable>
                  <Pressable onPress={() => void setQuestionStatus(row.id, 'draft').then(() => refreshTopic(topic)).catch(fail)} style={adminGhost}>
                    <AppText variant="caption">Taslağa al</AppText>
                  </Pressable>
                  <Pressable onPress={() => void setQuestionStatus(row.id, 'archived').then(() => refreshTopic(topic)).catch(fail)} style={adminGhost}>
                    <AppText variant="caption">Arşivle</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      askConfirm({
                        title: 'Soru arşivlensin mi?',
                        confirmLabel: 'Sil',
                        danger: true,
                        onConfirm: () => void setQuestionStatus(row.id, 'archived').then(() => refreshTopic(topic)).catch(fail),
                      })
                    }
                    style={adminGhost}>
                    <AppText variant="caption">Sil</AppText>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </View>

      <Modal visible={treeOpen} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#FFFCF7', maxHeight: '85%', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
            <Pressable onPress={() => setTreeOpen(false)} style={[adminGhost, { margin: 12 }]}>
              <AppText>Kapat</AppText>
            </Pressable>
            {treePanel}
          </View>
        </View>
      </Modal>

      <Modal visible={importOpen} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'center', padding: 16 }}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={[adminCard, { gap: 10 }]}>
            <AppText variant="title">Paket önizleme</AppText>
            <AppText>
              {pack?.package_name} · v{pack?.package_version}
            </AppText>
            {preview ? (
              <>
                <AppText variant="caption">Sınavlar: {preview.exams.join(', ') || '—'}</AppText>
                <AppText variant="caption">Dersler: {preview.subjects.join(', ') || '—'}</AppText>
                <AppText variant="caption">Ana konular: {preview.themes.join(', ') || '—'}</AppText>
                <AppText variant="caption">Konular: {preview.topics.length}</AppText>
                <AppText>Toplam soru: {preview.total}</AppText>
                <AppText>Yeni müfredat düğümü: {preview.newNodes}</AppText>
                <AppText>Var olan düğüm: {preview.reused}</AppText>
                <AppText>Pakette tekrarlayan: {preview.duplicatePreview}</AppText>
                <AppText>Geçersiz: {preview.invalid}</AppText>
                <AppText>Eşleme gerekli: {preview.needsMapping}</AppText>
              </>
            ) : null}
            {result ? (
              <View style={{ gap: 4 }}>
                <AppText variant="subtitle">İçe aktarım özeti</AppText>
                <AppText>Aktarılan: {result.imported}</AppText>
                <AppText>Yeni konu: {result.new_topics}</AppText>
                <AppText>Kullanılan konu: {result.reused_topics}</AppText>
                <AppText>Atlanan kopya: {result.duplicates_skipped}</AppText>
                <AppText>Geçersiz: {result.invalid}</AppText>
                <AppText>Eşleme gerekli: {result.needs_mapping}</AppText>
                <Pressable
                  onPress={() => {
                    setImportOpen(false);
                    setHistoryOpen(true);
                    if (result.batch_id) void listImportItems(result.batch_id).then(setHistoryItems).catch(fail);
                    void listQuestionImports().then(setHistory).catch(fail);
                  }}
                  style={adminGhost}>
                  <AppText>İçe Aktarım Detayını Gör</AppText>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <Pressable onPress={() => setImportOpen(false)} style={adminGhost}>
                  <AppText>Vazgeç</AppText>
                </Pressable>
                <Pressable disabled={busy} onPress={applyImport} style={adminBtn}>
                  <AppText tone="inverse">{busy ? 'Aktarılıyor…' : 'İçe Aktar'}</AppText>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={historyOpen} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'center', padding: 16 }}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={{ gap: 10 }}>
            <AppText variant="title">İçe aktarım geçmişi</AppText>
            {history.map((row) => (
              <Pressable
                key={row.id}
                onPress={() => void listImportItems(row.id).then(setHistoryItems).catch(fail)}
                style={adminCard}>
                <AppText>
                  {row.package_name || row.file_name} · {row.created_at.slice(0, 16).replace('T', ' ')}
                </AppText>
                <AppText variant="caption">
                  {row.status} · satır {row.total_rows} · eklenen {row.inserted_count} · kopya {row.duplicate_count} · geçersiz{' '}
                  {row.invalid_count} · yeni konu {row.created_topics}
                </AppText>
              </Pressable>
            ))}
            {historyItems.map((item) => (
              <AppText key={item.id} variant="caption">
                #{item.row_index} {item.outcome}
                {item.detail ? ` — ${item.detail}` : ''}
              </AppText>
            ))}
            <Pressable onPress={() => setHistoryOpen(false)} style={adminGhost}>
              <AppText>Kapat</AppText>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={Boolean(editor)} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'center', padding: 16 }}>
          {editor ? (
            <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={[adminCard, { gap: 10 }]}>
              <AppText variant="subtitle">{editor.id ? 'Soruyu düzenle' : 'Yeni soru'}</AppText>
              <AppText variant="caption">
                {exam?.name} / {subject?.name} / {unit?.name} / {topic?.name}
              </AppText>
              <TextInput value={editor.stem} onChangeText={(value) => setEditor({ ...editor, stem: value })} placeholder="Soru" multiline style={[adminField, { minHeight: 90 }]} />
              {(['A', 'B', 'C', 'D', 'E'] as const).map((key) => (
                <TextInput
                  key={key}
                  value={editor.choices[key] ?? ''}
                  onChangeText={(value) => setEditor({ ...editor, choices: { ...editor.choices, [key]: value } })}
                  placeholder={`${key} şıkkı`}
                  style={adminField}
                />
              ))}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(['A', 'B', 'C', 'D', 'E'] as const).map((key) => (
                  <Pressable key={key} onPress={() => setEditor({ ...editor, correct_choice: key })} style={[adminChip, editor.correct_choice === key && adminChipOn]}>
                    <AppText>{key} doğru</AppText>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={editor.explanation}
                onChangeText={(value) => setEditor({ ...editor, explanation: value })}
                placeholder="Açıklama"
                multiline
                style={[adminField, { minHeight: 72 }]}
              />
              <AppText variant="label">Zorluk</AppText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['easy', 'medium', 'hard'] as const).map((value) => (
                  <Pressable key={value} onPress={() => setEditor({ ...editor, difficulty: value })} style={[adminChip, editor.difficulty === value && adminChipOn]}>
                    <AppText>{DIFF_TR[value]}</AppText>
                  </Pressable>
                ))}
              </View>
              <AppText variant="label">Durum</AppText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['draft', 'needs_review', 'published'] as const).map((value) => (
                  <Pressable key={value} onPress={() => setEditor({ ...editor, question_status: value })} style={[adminChip, editor.question_status === value && adminChipOn]}>
                    <AppText>{STATUS_TR[value]}</AppText>
                  </Pressable>
                ))}
              </View>
              <AppText variant="label">Bu soru hangi sınavlarda geçerli?</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {tree.map((item) => {
                  const on = editor.exam_ids.includes(item.id);
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() =>
                        setEditor({
                          ...editor,
                          exam_ids: on ? editor.exam_ids.filter((id) => id !== item.id) : [...editor.exam_ids, item.id],
                        })
                      }
                      style={[adminChip, on && adminChipOn]}>
                      <AppText>{item.name}</AppText>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <Pressable onPress={() => setEditor(null)} style={adminGhost}>
                  <AppText>Vazgeç</AppText>
                </Pressable>
                <Pressable onPress={saveEditor} style={adminBtn}>
                  <AppText tone="inverse">Kaydet</AppText>
                </Pressable>
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      <Modal visible={Boolean(previewQ)} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'center', padding: 16 }}>
          {previewQ ? (
            <View style={adminCard}>
              <AppText variant="subtitle">Önizleme</AppText>
              <AppText>{previewQ.stem}</AppText>
              {Object.entries(previewQ.choices ?? {}).map(([key, text]) => (
                <AppText key={key}>
                  {key}) {String(text)}
                  {previewQ.correct_choice === key ? ' ✓' : ''}
                </AppText>
              ))}
              {previewQ.explanation ? <AppText variant="caption">{previewQ.explanation}</AppText> : null}
              <Pressable onPress={() => setPreviewQ(null)} style={adminGhost}>
                <AppText>Kapat</AppText>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ minWidth: 72, padding: 10, borderRadius: 12, backgroundColor: '#F3E0D4' }}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="subtitle">{value}</AppText>
    </View>
  );
}
