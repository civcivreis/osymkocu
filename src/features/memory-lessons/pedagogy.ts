export const MEMORY_TECHNIQUES = [
  'visual_association',
  'story_chain',
  'method_of_loci',
  'acronym',
  'chunking',
  'contrast_pair',
  'timeline',
  'absurd_imagery',
  'analogy',
  'pattern_recognition',
  'cause_effect_chain',
] as const;

export const QUESTION_STRATEGIES = [
  'direct_recall',
  'visual_recall',
  'contrast_recall',
  'sequence_recall',
  'application',
  'pattern_recognition',
  'first_move',
  'elimination',
  'exam_style',
] as const;

export type MemoryTechnique = (typeof MEMORY_TECHNIQUES)[number];
export type QuestionStrategy = (typeof QUESTION_STRATEGIES)[number];

export type CoreFact = {
  fact: string;
  technique: string;
  visual_anchor: string;
  recall_prompt: string;
};

const TECHNIQUE_LABELS: Record<string, string> = {
  visual_association: 'Görsel çağrışım',
  story_chain: 'Hikâye zinciri',
  method_of_loci: 'Mekân yöntemi',
  acronym: 'Kısaltma',
  chunking: 'Parçalama',
  contrast_pair: 'Zıt çift',
  timeline: 'Zaman çizgisi',
  absurd_imagery: 'Absürt imge',
  analogy: 'Analoji',
  pattern_recognition: 'Örüntü',
  cause_effect_chain: 'Neden-sonuç',
};

const STRATEGY_LABELS: Record<string, string> = {
  direct_recall: 'Doğrudan hatırlama',
  visual_recall: 'Görsel çıpa',
  contrast_recall: 'Karşılaştırma',
  sequence_recall: 'Sıra',
  application: 'Uygulama',
  pattern_recognition: 'Kalıp tanıma',
  first_move: 'İlk hamle',
  elimination: 'Eleme',
  exam_style: 'Sınav tipi',
};

export function techniqueLabel(value: string | null | undefined) {
  if (!value) return '—';
  return TECHNIQUE_LABELS[value] ?? value;
}

export function strategyLabel(value: string | null | undefined) {
  if (!value) return '—';
  return STRATEGY_LABELS[value] ?? value;
}

export function asCoreFacts(value: unknown): CoreFact[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      fact: String(row.fact ?? ''),
      technique: String(row.technique ?? 'visual_association'),
      visual_anchor: String(row.visual_anchor ?? ''),
      recall_prompt: String(row.recall_prompt ?? ''),
    };
  });
}
