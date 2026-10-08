import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminChip, adminChipOn, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { isStaffRole, isSuperAdmin, mapAdminError } from '@/src/features/admin/roles';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

type TaskRow = {
  task_type: string;
  primary_model: string;
  fallback_model?: string | null;
  quality_tier: string;
  minimum_quality_tier?: string;
  is_enabled: boolean;
  notes?: string | null;
  economy_model?: string | null;
  premium_model?: string | null;
};

type Overview = {
  settings?: {
    mode?: string;
    max_daily_ai_jobs?: number | null;
    max_daily_image_jobs?: number | null;
    max_daily_tts_jobs?: number | null;
    tts_voice?: string;
  };
  tasks?: TaskRow[];
  usage_today?: {
    calls?: number;
    text_calls?: number;
    image_calls?: number;
    tts_calls?: number;
    failures?: number;
    fallbacks?: number;
  };
};

const TASK_LABELS: Record<string, string> = {
  curriculum_discovery: 'Müfredat Keşfi',
  curriculum_diff: 'Müfredat Farkı',
  curriculum_decomposition: 'Müfredat Ayrıştırma',
  canonical_topic_matching: 'Kanonik Konu Eşleme',
  lesson_generation: 'Ders Üretimi',
  memory_pedagogy_generation: 'Hafıza Pedagojisi',
  exam_technique_validation: 'Sınav Tekniği Doğrulama',
  lesson_quality_validation: 'Ders Kalite Kontrolü',
  question_generation: 'Soru Üretimi',
  question_validation: 'Soru Kontrolü',
  question_similarity_check: 'Soru Benzerlik',
  bot_conversation: 'Bot Sohbeti',
  social_post_generation: 'Sosyal Paylaşım',
  social_comment_generation: 'Sosyal Yorum',
  image_generation: 'Görsel',
  premium_image_generation: 'Premium Görsel',
  tts_generation: 'Ses',
  content_moderation_text: 'Metin Moderasyonu',
  content_moderation_image: 'Görsel Moderasyonu',
};

export function AdminAiSettingsScreen() {
  const role = useAuthStore((s) => s.profile?.app_role);
  const canEdit = isSuperAdmin(role);
  const overview = useQuery({
    queryKey: ['admin-ai-router'],
    enabled: isStaffRole(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_ai_router_overview');
      if (error) throw new Error(mapAdminError(error.message));
      return data as Overview;
    },
  });

  const settings = overview.data?.settings ?? {};
  const usage = overview.data?.usage_today ?? {};
  const mode = settings.mode ?? 'balanced';
  const tasks = overview.data?.tasks ?? [];

  const setMode = (next: string) => {
    if (!canEdit) return;
    void getSupabase()
      .rpc('admin_set_ai_runtime_mode', { p_mode: next })
      .then(({ error }) => {
        if (error) toastError(mapAdminError(error.message));
        else {
          toastSuccess('Çalışma modu güncellendi');
          void overview.refetch();
        }
      });
  };

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">AI Ayarları</AppText>
      <AppText tone="muted">
        Model seçimi yalnızca sunucuda yapılır. API anahtarları burada görünmez ve değiştirilemez.
      </AppText>

      <View style={adminCard}>
        <AppText variant="subtitle">Çalışma Modu</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['economy', 'Ekonomi'],
              ['balanced', 'Dengeli'],
              ['premium', 'Premium'],
            ] as const
          ).map(([id, label]) => (
            <Pressable
              key={id}
              disabled={!canEdit}
              onPress={() => setMode(id)}
              style={[adminChip, mode === id ? adminChipOn : null]}>
              <AppText variant="caption">{label}</AppText>
            </Pressable>
          ))}
        </View>
        <AppText variant="caption" tone="muted">
          Ekonomi: yüksek hacimli işler daha ucuz yapılandırılmış modelleri kullanır. Dengeli: önerilen. Premium:
          uygun üretim işlerinde daha güçlü modeller. Müfredat ve doğrulama minimum kalite eşiğinin altına inmez.
        </AppText>
        {!canEdit ? (
          <AppText variant="caption" tone="muted">
            Model ve mod değişikliği yalnızca süper admin.
          </AppText>
        ) : null}
        <AppText variant="caption" tone="muted">
          Model değişince mevcut ders, soru, görsel ve sesler otomatik yenilenmez. Tekil yeniden üretim mevcut üretim
          butonlarından yapılır.
        </AppText>
      </View>

      <View style={adminCard}>
        <AppText variant="subtitle">Bugün</AppText>
        <AppText>
          Çağrı {usage.calls ?? 0} · metin {usage.text_calls ?? 0} · görsel {usage.image_calls ?? 0} · ses{' '}
          {usage.tts_calls ?? 0}
        </AppText>
        <AppText variant="caption">
          Hata {usage.failures ?? 0} · yedek model {usage.fallbacks ?? 0} · ses modeli {settings.tts_voice ?? '—'}
        </AppText>
      </View>

      {overview.isError ? (
        <AppText tone="danger">{overview.error instanceof Error ? overview.error.message : 'Yüklenemedi'}</AppText>
      ) : null}

      {tasks.map((task) => (
        <TaskCard key={task.task_type} task={task} canEdit={canEdit} onSaved={() => void overview.refetch()} />
      ))}
    </View>
  );
}

function TaskCard({
  task,
  canEdit,
  onSaved,
}: {
  task: TaskRow;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [primary, setPrimary] = useState(task.primary_model);
  const [fallback, setFallback] = useState(task.fallback_model ?? '');
  const [tier, setTier] = useState(task.quality_tier);
  const [enabled, setEnabled] = useState(task.is_enabled);
  const dirty = useMemo(
    () =>
      primary !== task.primary_model ||
      fallback !== (task.fallback_model ?? '') ||
      tier !== task.quality_tier ||
      enabled !== task.is_enabled,
    [primary, fallback, tier, enabled, task],
  );

  const save = () => {
    if (!canEdit) return;
    if (!primary.trim()) {
      toastError('Model adı boş olamaz.');
      return;
    }
    void getSupabase()
      .rpc('admin_update_ai_model_config', {
        p_task_type: task.task_type,
        p_primary_model: primary.trim(),
        p_fallback_model: fallback.trim() || null,
        p_quality_tier: tier,
        p_enabled: enabled,
      })
      .then(({ error }) => {
        if (error) toastError(mapAdminError(error.message));
        else {
          toastSuccess('Yönlendirme güncellendi');
          onSaved();
        }
      });
  };

  return (
    <View style={adminCard}>
      <AppText variant="subtitle">{TASK_LABELS[task.task_type] ?? task.task_type}</AppText>
      <AppText variant="caption" tone="muted">
        {task.task_type} · min {task.minimum_quality_tier ?? 'economy'}
        {task.notes ? ` · ${task.notes}` : ''}
      </AppText>
      {canEdit ? (
        <>
          <TextInput value={primary} onChangeText={setPrimary} placeholder="Birincil model" style={adminField} />
          <TextInput value={fallback} onChangeText={setFallback} placeholder="Yedek model (isteğe bağlı)" style={adminField} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['economy', 'balanced', 'premium'] as const).map((id) => (
              <Pressable key={id} onPress={() => setTier(id)} style={[adminChip, tier === id ? adminChipOn : null]}>
                <AppText variant="caption">{id}</AppText>
              </Pressable>
            ))}
            <Pressable onPress={() => setEnabled((v) => !v)} style={adminGhost}>
              <AppText variant="caption">{enabled ? 'Açık' : 'Kapalı'}</AppText>
            </Pressable>
          </View>
          {dirty ? (
            <Pressable onPress={save} style={adminBtn}>
              <AppText variant="caption" style={{ color: '#fff' }}>
                Kaydet
              </AppText>
            </Pressable>
          ) : null}
        </>
      ) : (
        <AppText>
          {task.primary_model}
          {task.fallback_model ? ` · yedek ${task.fallback_model}` : ''} · {task.quality_tier} ·{' '}
          {task.is_enabled ? 'açık' : 'kapalı'}
        </AppText>
      )}
    </View>
  );
}
