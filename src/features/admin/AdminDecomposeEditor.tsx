import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { applyDecomposition, saveDecompositionDraft } from '@/src/features/curriculum/decomposeApi';
import type { DecompositionItem, DecompositionProposal } from '@/src/features/curriculum/decomposeTypes';

function moveItem(items: DecompositionItem[], index: number, dir: -1 | 1) {
  const next = [...items];
  const target = index + dir;
  if (target < 0 || target >= next.length) return items;
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next.map((item, order) => ({ ...item, item_order: order }));
}

export function AdminDecomposeEditor({
  proposal,
  onClose,
  onApplied,
}: {
  proposal: DecompositionProposal;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [items, setItems] = useState<DecompositionItem[]>(() =>
    [...(proposal.items ?? [])].sort((a, b) => a.item_order - b.item_order),
  );
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const selected = useMemo(() => items.filter((item) => item.selected), [items]);
  const topicMode = proposal.mode === 'topic';
  const tooBroad = Boolean(proposal.ai_payload?.too_broad_for_single_lesson);

  const patch = (id: string, next: Partial<DecompositionItem>) => {
    setItems((cur) => cur.map((item) => (item.id === id ? { ...item, ...next } : item)));
  };

  const fail = (error: unknown) => {
    toastError(mapAdminError(error instanceof Error ? error.message : 'İşlem başarısız.'));
  };

  const saveDraft = () => {
    setBusy(true);
    void saveDecompositionDraft(proposal.id, items)
      .then(() => toastSuccess('Taslak kaydedildi'))
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const apply = (opts: { keepSingle?: boolean; enqueue?: boolean }) => {
    const go = () => {
      setBusy(true);
      void applyDecomposition({
        proposal,
        items,
        keepSingle: opts.keepSingle,
        keepSingleReason: opts.keepSingle ? 'Tek ders olarak bırak' : undefined,
        enqueue: opts.enqueue,
      })
        .then(() => {
          toastSuccess(opts.enqueue ? 'Müfredata eklendi ve kuyruğa alındı' : 'Müfredata eklendi. Üretim başlamadı.');
          onApplied();
        })
        .catch(fail)
        .finally(() => setBusy(false));
    };
    askConfirm({
      title: opts.keepSingle ? 'Tek ders olarak bırakılsın mı?' : 'Onayla ve müfredata ekle?',
      subtitle: opts.enqueue ? 'Seçili konular üretim kuyruğuna da eklenir.' : 'İçerik üretimi otomatik başlamaz.',
      confirmLabel: 'Onayla',
      onConfirm: go,
    });
  };

  const mergeSelected = () => {
    const picks = items.filter((item) => item.selected);
    if (picks.length < 2) {
      toastError('Birleştirmek için en az iki konu seç.');
      return;
    }
    const [first, ...rest] = picks;
    const merged: DecompositionItem = {
      ...first,
      title: picks.map((item) => item.title).join(' / '),
      description: picks.map((item) => item.description).filter(Boolean).join(' '),
      estimated_minutes: picks.reduce((sum, item) => sum + Number(item.estimated_minutes || 0), 0),
      estimated_core_fact_count: picks.reduce((sum, item) => sum + Number(item.estimated_core_fact_count || 0), 0),
      too_broad: true,
      learning_objectives: picks.flatMap((item) => item.learning_objectives ?? []),
    };
    setItems((cur) => cur.filter((item) => !rest.some((row) => row.id === item.id)).map((item) => (item.id === first.id ? merged : item)));
  };

  return (
    <View style={[adminCard, { gap: 12 }]}>
      <AppText variant="title">
        {proposal.title} — {topicMode ? 'Ders yapısı' : 'Konu önerileri'}
      </AppText>
      {topicMode ? (
        <AppText tone={tooBroad ? 'danger' : 'muted'}>
          {tooBroad ? 'Tek ders için fazla geniş' : 'Tek ders olarak uygun görünüyor'}
        </AppText>
      ) : null}
      {Array.isArray(proposal.coverage_warnings) && proposal.coverage_warnings.length > 0 ? (
        <AppText variant="caption" tone="danger">
          {proposal.coverage_warnings.map(String).join(' · ')}
        </AppText>
      ) : null}

      {items.map((item, index) => (
        <View key={item.id} style={{ gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EDE6D8' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Pressable onPress={() => setItems(moveItem(items, index, -1))} style={adminGhost}>
              <AppText>☰ ↑</AppText>
            </Pressable>
            <Pressable onPress={() => setItems(moveItem(items, index, 1))} style={adminGhost}>
              <AppText>↓</AppText>
            </Pressable>
            <Pressable onPress={() => patch(item.id, { selected: !item.selected })} style={[adminChip, item.selected && adminChipOn]}>
              <AppText>{item.selected ? 'Seçili' : 'Hariç'}</AppText>
            </Pressable>
            {item.match_status === 'MATCH_EXISTING' ? (
              <AppText variant="caption" tone="accent">
                MATCH_EXISTING · {item.matched_title}
              </AppText>
            ) : null}
            {item.too_broad ? (
              <AppText variant="caption" tone="danger">
                Geniş konu
              </AppText>
            ) : null}
          </View>
          <TextInput value={item.title} onChangeText={(value) => patch(item.id, { title: value })} style={adminField} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <TextInput
              value={String(item.estimated_minutes ?? '')}
              onChangeText={(value) => patch(item.id, { estimated_minutes: Number(value) || 0 })}
              keyboardType="numeric"
              placeholder="dk"
              style={[adminField, { width: 90 }]}
            />
            <TextInput
              value={String(item.estimated_core_fact_count ?? '')}
              onChangeText={(value) => patch(item.id, { estimated_core_fact_count: Number(value) || 0 })}
              keyboardType="numeric"
              placeholder="olgu"
              style={[adminField, { width: 90 }]}
            />
            <Pressable
              onPress={() => patch(item.id, { importance: item.importance === 'core' ? 'supporting' : 'core' })}
              style={adminChip}>
              <AppText variant="caption">{item.importance ?? 'core'}</AppText>
            </Pressable>
          </View>
          {item.match_status === 'MATCH_EXISTING' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pressable onPress={() => patch(item.id, { match_action: 'use_existing' })} style={[adminChip, item.match_action === 'use_existing' && adminChipOn]}>
                <AppText variant="caption">Use Existing</AppText>
              </Pressable>
              <Pressable onPress={() => patch(item.id, { match_action: 'create' })} style={[adminChip, item.match_action === 'create' && adminChipOn]}>
                <AppText variant="caption">Create Separate Topic</AppText>
              </Pressable>
            </View>
          ) : null}
          <Pressable onPress={() => setItems((cur) => cur.filter((row) => row.id !== item.id))} style={adminGhost}>
            <AppText variant="caption">Kaldır</AppText>
          </Pressable>
        </View>
      ))}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <TextInput value={newTitle} onChangeText={setNewTitle} placeholder="Yeni konu" style={[adminField, { flex: 1, minWidth: 160 }]} />
        <Pressable
          onPress={() => {
            if (!newTitle.trim()) return;
            setItems((cur) => [
              ...cur,
              {
                id: `${Date.now()}`,
                selected: true,
                title: newTitle.trim(),
                estimated_minutes: 6,
                estimated_core_fact_count: 6,
                importance: 'core',
                item_order: cur.length,
                learning_objectives: [],
                match_status: 'NEW',
                match_action: 'create',
                should_have_own_lesson: true,
              },
            ]);
            setNewTitle('');
          }}
          style={adminGhost}>
          <AppText>Ekle</AppText>
        </Pressable>
        <Pressable onPress={mergeSelected} style={adminGhost}>
          <AppText>Seçilenleri birleştir</AppText>
        </Pressable>
        <Pressable
          onPress={() => {
            const first = selected[0];
            if (!first) return;
            setItems((cur) => [
              ...cur,
              {
                ...first,
                id: `${Date.now()}`,
                title: `${first.title} (2)`,
                item_order: cur.length,
                match_status: 'NEW',
                matched_canonical_topic_id: null,
                match_action: 'create',
              },
            ]);
          }}
          style={adminGhost}>
          <AppText>Böl</AppText>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable onPress={onClose} style={adminGhost}>
          <AppText>İptal</AppText>
        </Pressable>
        <Pressable disabled={busy} onPress={saveDraft} style={adminGhost}>
          <AppText>Taslak Kaydet</AppText>
        </Pressable>
        {topicMode ? (
          <>
            <Pressable disabled={busy} onPress={() => apply({ keepSingle: false })} style={adminBtn}>
              <AppText tone="inverse">Bu yapıyı kullan</AppText>
            </Pressable>
            <Pressable disabled={busy} onPress={() => apply({ keepSingle: true })} style={adminGhost}>
              <AppText>Tek ders olarak bırak</AppText>
            </Pressable>
          </>
        ) : (
          <Pressable disabled={busy} onPress={() => apply({})} style={adminBtn}>
            <AppText tone="inverse">Onayla ve Müfredata Ekle</AppText>
          </Pressable>
        )}
        <Pressable disabled={busy} onPress={() => apply({ enqueue: true, keepSingle: topicMode ? tooBroad === false : undefined })} style={adminGhost}>
          <AppText>Üretim Kuyruğuna Ekle</AppText>
        </Pressable>
      </View>
    </View>
  );
}
