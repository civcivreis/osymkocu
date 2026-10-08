import { getSupabase } from '@/src/lib/supabase/client';
import { queueSingleTopic } from '@/src/features/content-factory/factoryApi';

import type { CanonicalTopicMeta, DecompositionItem, DecompositionProposal } from './decomposeTypes';

function invokeError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const err = (payload as { error?: { message?: string } }).error;
    if (err?.message) return new Error(err.message);
  }
  return new Error(fallback);
}

export async function runCurriculumDecompose(input: {
  mode: 'unit' | 'topic';
  curriculum_version_id?: string | null;
  subject_id?: string | null;
  unit_id?: string | null;
  canonical_topic_id?: string | null;
  exam_id?: string | null;
}) {
  const invoked = await getSupabase().functions.invoke('curriculum-decompose', { body: input });
  if (invoked.error) throw invokeError(invoked.data, 'Müfredat analizi başarısız.');
  const proposal = (invoked.data as { proposal?: DecompositionProposal })?.proposal;
  if (!proposal) throw new Error('Öneri oluşturulamadı.');
  return proposal;
}

export async function saveDecompositionDraft(id: string, items: DecompositionItem[]) {
  const { error } = await getSupabase()
    .from('curriculum_decomposition_proposals')
    .update({ items, status: 'draft' })
    .eq('id', id);
  if (error) throw error;
}

export async function getDecompositionProposal(id: string) {
  const { data, error } = await getSupabase().from('curriculum_decomposition_proposals').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as DecompositionProposal | null;
}

export async function listCanonicalTopicMeta(canonicalUnitId: string | null) {
  if (!canonicalUnitId) return [] as CanonicalTopicMeta[];
  const { data, error } = await getSupabase()
    .from('canonical_topics')
    .select('id, name, too_broad, keep_single_override, analysis_status, estimated_minutes, estimated_core_fact_count, memory_journey_feasibility')
    .eq('canonical_unit_id', canonicalUnitId);
  if (error) throw error;
  const rows = (data ?? []) as CanonicalTopicMeta[];
  const { data: objectives } = await getSupabase()
    .from('canonical_topic_learning_objectives')
    .select('canonical_topic_id');
  const counts = new Map<string, number>();
  for (const row of objectives ?? []) {
    const id = (row as { canonical_topic_id: string }).canonical_topic_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return rows.map((row) => ({ ...row, objective_count: counts.get(row.id) ?? 0 }));
}

async function slugFromName(name: string) {
  const { data } = await getSupabase().rpc('catalog_slug_from_name', { p_name: name });
  return String(data ?? 'konu');
}

async function ensureCanonicalUnit(proposal: DecompositionProposal) {
  if (proposal.canonical_unit_id) return proposal.canonical_unit_id;
  if (!proposal.unit_id || !proposal.subject_id) throw new Error('NO_CANONICAL');
  const db = getSupabase();
  const { data: unit } = await db.from('unit_catalog').select('id, name, canonical_unit_id, subject_id').eq('id', proposal.unit_id).maybeSingle();
  if (unit?.canonical_unit_id) return unit.canonical_unit_id as string;
  const { data: subject } = await db.from('subject_catalog').select('id, name, canonical_subject_id').eq('id', proposal.subject_id).maybeSingle();
  let subjectId = subject?.canonical_subject_id as string | null;
  if (!subjectId && subject) {
    const slug = await slugFromName(subject.name);
    const inserted = await db.from('canonical_subjects').insert({ name: subject.name, slug, code: slug.toUpperCase().replace(/-/g, '_') }).select('id').single();
    if (inserted.error || !inserted.data) throw inserted.error ?? new Error('NO_CANONICAL');
    subjectId = inserted.data.id;
    await db.from('subject_catalog').update({ canonical_subject_id: subjectId }).eq('id', subject.id);
  }
  if (!subjectId || !unit) throw new Error('NO_CANONICAL');
  const unitSlug = await slugFromName(unit.name);
  const insertedUnit = await db.from('canonical_units').insert({ canonical_subject_id: subjectId, name: unit.name, slug: unitSlug }).select('id').single();
  if (insertedUnit.error || !insertedUnit.data) throw insertedUnit.error ?? new Error('NO_CANONICAL');
  await db.from('unit_catalog').update({ canonical_unit_id: insertedUnit.data.id }).eq('id', unit.id);
  return insertedUnit.data.id as string;
}

async function writeObjectives(canonicalTopicId: string, titles: string[]) {
  const db = getSupabase();
  const { count } = await db.from('canonical_topic_learning_objectives').select('id', { count: 'exact', head: true }).eq('canonical_topic_id', canonicalTopicId);
  if ((count ?? 0) > 0) return;
  const rows = titles.filter((title) => title.trim()).map((title, index) => ({
    canonical_topic_id: canonicalTopicId,
    title: title.trim().slice(0, 240),
    objective_order: index + 1,
    importance: 'core',
  }));
  if (rows.length === 0) return;
  const { error } = await db.from('canonical_topic_learning_objectives').insert(rows);
  if (error) throw error;
}

async function mapExamTopic(input: {
  versionId: string | null;
  canonicalTopicId: string;
  subjectId: string | null;
  unitId: string | null;
  topicId: string | null;
}) {
  if (!input.versionId) return;
  const { error } = await getSupabase().from('exam_topic_map').insert({
    curriculum_version_id: input.versionId,
    canonical_topic_id: input.canonicalTopicId,
    subject_id: input.subjectId,
    unit_id: input.unitId,
    topic_id: input.topicId,
    included: true,
    coverage_mode: 'core',
    depth_level: 'standard',
  });
  if (error && !String(error.message).toLowerCase().includes('duplicate') && error.code !== '23505') throw error;
}

async function createCatalogTopic(unitId: string | null, name: string, canonicalTopicId: string, description?: string) {
  if (!unitId) return null;
  const { data, error } = await getSupabase()
    .from('topic_catalog')
    .insert({
      unit_id: unitId,
      name,
      description: description ?? null,
      content_status: 'empty',
      canonical_topic_id: canonicalTopicId,
    })
    .select('id')
    .single();
  if (error) {
    const { data: existing } = await getSupabase()
      .from('topic_catalog')
      .select('id')
      .eq('unit_id', unitId)
      .ilike('name', name)
      .maybeSingle();
    if (existing?.id) {
      await getSupabase().from('topic_catalog').update({ canonical_topic_id: canonicalTopicId, content_status: 'empty' }).eq('id', existing.id);
      return existing.id as string;
    }
    throw error;
  }
  return data.id as string;
}

async function upsertCanonicalTopic(unitId: string, item: DecompositionItem) {
  const db = getSupabase();
  const slug = await slugFromName(item.title);
  const { data: bySlug } = await db.from('canonical_topics').select('id').eq('canonical_unit_id', unitId).eq('slug', slug).maybeSingle();
  if (bySlug?.id) return bySlug.id as string;
  const { data: byName } = await db.from('canonical_topics').select('id').eq('canonical_unit_id', unitId).ilike('name', item.title).maybeSingle();
  if (byName?.id) return byName.id as string;
  const inserted = await db
    .from('canonical_topics')
    .insert({
      canonical_unit_id: unitId,
      name: item.title,
      slug,
      description: item.description ?? null,
      estimated_minutes: item.estimated_minutes,
      estimated_core_fact_count: item.estimated_core_fact_count,
      too_broad: Boolean(item.too_broad),
      memory_journey_feasibility: item.memory_journey_feasibility ?? 'medium',
      analysis_status: item.too_broad ? 'split_recommended' : 'ready',
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) throw inserted.error ?? new Error('NO_CANONICAL');
  return inserted.data.id as string;
}

export async function applyDecomposition(input: {
  proposal: DecompositionProposal;
  items: DecompositionItem[];
  keepSingle?: boolean;
  keepSingleReason?: string;
  enqueue?: boolean;
}) {
  const db = getSupabase();
  const selected = input.items.filter((item) => item.selected);
  const createdIds: string[] = [];

  if (input.proposal.mode === 'topic' && input.proposal.canonical_topic_id) {
    const parentId = input.proposal.canonical_topic_id;
    const payload = input.proposal.ai_payload ?? {};
    const objectives = Array.isArray(payload.learning_objectives)
      ? (payload.learning_objectives as unknown[]).map((item) => String(item))
      : [];
    if (input.keepSingle) {
      await db
        .from('canonical_topics')
        .update({
          keep_single_override: true,
          keep_single_reason: input.keepSingleReason || 'Tek ders olarak bırak',
          too_broad: false,
          analysis_status: 'ready',
          estimated_minutes: Number(payload.estimated_minutes ?? 8),
          estimated_core_fact_count: Number(payload.estimated_core_fact_count ?? 7),
          memory_journey_feasibility: String(payload.memory_journey_feasibility ?? 'high'),
        })
        .eq('id', parentId);
      await writeObjectives(parentId, objectives);
    } else {
      await db.from('canonical_topic_segments').delete().eq('canonical_topic_id', parentId);
      for (const [index, item] of selected.entries()) {
        const slug = await slugFromName(item.title);
        await db.from('canonical_topic_segments').insert({
          canonical_topic_id: parentId,
          title: item.title,
          slug: `${slug}-${index + 1}`,
          description: item.description ?? null,
          segment_order: index + 1,
          estimated_minutes: item.estimated_minutes,
          estimated_core_fact_count: item.estimated_core_fact_count,
          should_have_own_lesson: Boolean(item.should_have_own_lesson),
          decomposition_reason: item.reason ?? null,
        });
        if (item.should_have_own_lesson) {
          const unitId = await ensureCanonicalUnit(input.proposal);
          const canonicalId =
            item.match_action === 'use_existing' && item.matched_canonical_topic_id
              ? item.matched_canonical_topic_id
              : await upsertCanonicalTopic(unitId, { ...item, too_broad: false, memory_journey_feasibility: 'high' });
          const catalogId = await createCatalogTopic(input.proposal.unit_id, item.title, canonicalId, item.description);
          await mapExamTopic({
            versionId: input.proposal.curriculum_version_id,
            canonicalTopicId: canonicalId,
            subjectId: input.proposal.subject_id,
            unitId: input.proposal.unit_id,
            topicId: catalogId,
          });
          await writeObjectives(canonicalId, item.learning_objectives?.length ? item.learning_objectives : [`${item.title} konusunun temel olgularını açıklar.`]);
          createdIds.push(canonicalId);
        }
      }
      await db
        .from('canonical_topics')
        .update({
          too_broad: true,
          analysis_status: 'split_recommended',
          keep_single_override: false,
        })
        .eq('id', parentId);
      if (objectives.length) await writeObjectives(parentId, objectives);
    }
  } else {
    const unitId = await ensureCanonicalUnit(input.proposal);
    for (const item of selected) {
      const canonicalId =
        item.match_action === 'use_existing' && item.matched_canonical_topic_id
          ? item.matched_canonical_topic_id
          : await upsertCanonicalTopic(unitId, item);
      await db
        .from('canonical_topics')
        .update({
          estimated_minutes: item.estimated_minutes,
          estimated_core_fact_count: item.estimated_core_fact_count,
          too_broad: Boolean(item.too_broad),
          memory_journey_feasibility: item.memory_journey_feasibility ?? 'medium',
          analysis_status: item.too_broad ? 'split_recommended' : 'ready',
        })
        .eq('id', canonicalId);
      const catalogId = await createCatalogTopic(input.proposal.unit_id, item.title, canonicalId, item.description);
      await mapExamTopic({
        versionId: input.proposal.curriculum_version_id,
        canonicalTopicId: canonicalId,
        subjectId: input.proposal.subject_id,
        unitId: input.proposal.unit_id,
        topicId: catalogId,
      });
      await writeObjectives(canonicalId, item.learning_objectives ?? []);
      createdIds.push(canonicalId);
    }
  }

  await db.from('curriculum_decomposition_proposals').update({ status: 'approved', items: input.items }).eq('id', input.proposal.id);

  if (input.enqueue) {
    for (const id of createdIds) {
      const { data: ready } = await db.rpc('canonical_topic_factory_ready', { p_id: id });
      if (!ready) continue;
      await queueSingleTopic({
        canonical_topic_id: id,
        curriculum_version_id: input.proposal.curriculum_version_id,
        exam_id: input.proposal.exam_id,
        subject_id: input.proposal.subject_id,
        unit_id: input.proposal.unit_id,
      });
    }
  }

  return { created: createdIds.length, queued: Boolean(input.enqueue) };
}
