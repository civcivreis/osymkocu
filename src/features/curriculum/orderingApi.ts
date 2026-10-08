import { getSupabase } from '@/src/lib/supabase/client';

export type OrderingBoardTopic = {
  map_id: string;
  canonical_topic_id: string;
  official_sort: number;
  topic_name: string;
  difficulty_level: number;
  recommended_rank: number | null;
};

export type OrderingDependency = {
  id: string;
  topic_id: string;
  depends_on_topic_id: string;
  dependency_type: string;
  strength: string;
  reason: string | null;
  status: string;
};

export type OrderingSuggestion = {
  id: string;
  topic_id: string | null;
  depends_on_topic_id: string | null;
  dependency_type: string;
  reason: string | null;
  status: string;
};

export type OrderingBoard = {
  topics: OrderingBoardTopic[];
  dependencies: OrderingDependency[];
  suggestions: OrderingSuggestion[];
  has_frequency: boolean;
};

export async function getUnitOrderingBoard(versionId: string, unitId: string): Promise<OrderingBoard> {
  const { data, error } = await getSupabase().rpc('admin_unit_ordering_board', {
    p_version: versionId,
    p_unit: unitId,
  });
  if (error) throw error;
  const payload = (data ?? {}) as OrderingBoard;
  return {
    topics: payload.topics ?? [],
    dependencies: payload.dependencies ?? [],
    suggestions: payload.suggestions ?? [],
    has_frequency: Boolean(payload.has_frequency),
  };
}

export async function addTopicDependency(input: {
  topicId: string;
  dependsOnId: string;
  type: string;
  strength?: string;
  reason?: string;
}) {
  const { data, error } = await getSupabase().rpc('admin_add_topic_dependency', {
    p_topic: input.topicId,
    p_depends_on: input.dependsOnId,
    p_type: input.type,
    p_strength: input.strength ?? 'medium',
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function removeTopicDependency(id: string) {
  const { error } = await getSupabase().rpc('admin_remove_topic_dependency', { p_id: id });
  if (error) throw error;
}

export async function setExamTopicSort(mapId: string, sort: number) {
  const { error } = await getSupabase().rpc('admin_set_exam_topic_sort', { p_map_id: mapId, p_sort: sort });
  if (error) throw error;
}

export async function applyOrderingSuggestion(id: string, apply: boolean) {
  const { data, error } = await getSupabase().rpc('admin_apply_ordering_suggestion', { p_id: id, p_apply: apply });
  if (error) throw error;
  return data;
}

export async function checkHardCycle(topicId: string, dependsOnId: string) {
  const { data, error } = await getSupabase().rpc('hard_dependency_would_cycle', {
    p_topic: topicId,
    p_depends_on: dependsOnId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function suggestCurriculumOrder(input: { curriculum_version_id: string; unit_id?: string | null }) {
  const invoked = await getSupabase().functions.invoke('curriculum-order-suggest', { body: input });
  if (invoked.error) {
    const payload = invoked.data as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? 'Sıralama önerisi alınamadı.');
  }
  return invoked.data as { created?: number };
}
