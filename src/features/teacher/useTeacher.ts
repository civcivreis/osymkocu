import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AIService } from '@/src/lib/ai/AIService';
import { AiServiceError, type AiMode, type ExplanationResult } from '@/src/lib/ai/types';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { getDailyAiLimit } from '@/src/lib/billing/featureGate';
import { getSupabase } from '@/src/lib/supabase/client';
import { todayIsoIstanbul } from '@/src/lib/time/istanbul';
import { useAuthStore } from '@/src/stores/authStore';

export type TeacherMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUri?: string;
  result?: ExplanationResult;
};

export const AI_MODES: { value: AiMode; label: string }[] = [
  { value: 'simple', label: 'Kısa' },
  { value: 'detailed', label: 'Daha açık' },
];

export function formatTeacherResult(result: ExplanationResult) {
  const raw = (result.reply || result.solution || result.answer || '').trim();
  const text = raw.replace(/^Doğru:\s*/i, '');
  if (result.kind !== 'lesson') return text;
  const answer = result.answer?.trim();
  if (answer && /^[A-E]$/i.test(answer) && text && !text.startsWith(answer)) {
    return `Doğru şık: ${answer}\n\n${text}`;
  }
  return text;
}

async function persistTurn(input: {
  userId: string;
  question: string;
  answer: string;
  mode: AiMode;
}) {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('ai_conversations')
    .select('id')
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = existing?.id as string | undefined;
  if (!conversationId) {
    const { data: created, error } = await supabase
      .from('ai_conversations')
      .insert({ user_id: input.userId, title: input.question.slice(0, 80) })
      .select('id')
      .single();
    if (error) throw error;
    conversationId = created.id;
  }

  const { error } = await supabase.from('ai_messages').insert([
    { conversation_id: conversationId, role: 'user', content: input.question, mode: input.mode },
    { conversation_id: conversationId, role: 'assistant', content: input.answer, mode: input.mode },
  ]);
  if (error) throw error;
}

export function useTeacher() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const plan = useAuthStore((s) => s.subscription?.plan ?? 'free');
  const client = useQueryClient();

  const usageQuery = useQuery({
    queryKey: ['ai-usage', userId, todayIsoIstanbul()],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('ai_usage')
        .select('daily_requests')
        .eq('user_id', userId!)
        .eq('used_on', todayIsoIstanbul())
        .maybeSingle();
      if (error) throw error;
      return data?.daily_requests ?? 0;
    },
  });

  const historyQuery = useQuery({
    queryKey: ['ai-conversation', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const supabase = getSupabase();
      const { data: conversation, error: conversationError } = await supabase
        .from('ai_conversations')
        .select('id')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) return [] as TeacherMessage[];

      const { data: rows, error } = await supabase
        .from('ai_messages')
        .select('id, role, content')
        .eq('conversation_id', conversation.id)
        .order('created_at');
      if (error) throw error;
      return (rows ?? []).map((row) => ({
        id: row.id,
        role: row.role as TeacherMessage['role'],
        content: row.content,
      }));
    },
  });

  const ask = useMutation({
    mutationFn: async (input: {
      question: string;
      mode: AiMode;
      imageBase64?: string;
      imageUrl?: string;
      imagePath?: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
      appContext?: Record<string, unknown>;
    }) => {
      const history = (input.history ?? []).slice(-24);
      const appContext = input.appContext;
      const hasImage = Boolean(input.imageBase64 || input.imageUrl || input.imagePath);
      const result = hasImage
        ? await AIService.solveImageQuestion({
            imageBase64: input.imageBase64,
            imageUrl: input.imageUrl,
            imagePath: input.imagePath,
            mode: input.mode,
            history,
            appContext,
            question: input.question,
          })
        : await AIService.generateExplanation({
            question: input.question,
            mode: input.mode,
            history,
            appContext,
            imageUrl: input.imageUrl,
            imagePath: input.imagePath,
          });
      const content = formatTeacherResult(result);
      if (userId) {
        try {
          await persistTurn({
            userId,
            question: input.question,
            answer: content,
            mode: input.mode,
          });
        } catch {
          // reply still shown; history retry on next turn
        }
      }
      return { result, content };
    },
    onSuccess: async (_data, variables) => {
      AnalyticsProvider.track(variables.imageBase64 ? 'image_question_sent' : 'ai_question_sent');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['ai-usage'] }),
        client.invalidateQueries({ queryKey: ['ai-conversation'] }),
      ]);
    },
  });

  return {
    plan,
    dailyUsed: usageQuery.data ?? 0,
    dailyLimit: getDailyAiLimit(plan),
    history: historyQuery.data ?? [],
    historyLoading: historyQuery.isLoading,
    ask,
    mapError(error: unknown) {
      if (error instanceof AiServiceError) {
        if (error.code === 'LIMIT_REACHED') return 'Günlük AI hakkın doldu. Yarın tekrar dene veya Pro’ya geç.';
        if (error.code === 'AI_NOT_CONFIGURED') return error.message;
        return error.message;
      }
      return error instanceof Error ? error.message : 'AI yanıtı alınamadı';
    },
  };
}
