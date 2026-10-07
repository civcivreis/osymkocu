import { getSupabase } from '@/src/lib/supabase/client';

import {
  AiServiceError,
  type AiAction,
  type AiErrorCode,
  type AnalyzeAnswerInput,
  type ExplanationInput,
  type ExplanationResult,
  type GenerateQuestionInput,
  type ImageQuestionInput,
  type RevisionInput,
  type StudyPlanInput,
  type WeakTopicInput,
} from './types';

type InvokeResponse<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

function asErrorCode(code: string | undefined): AiErrorCode {
  if (
    code === 'AI_NOT_CONFIGURED' ||
    code === 'LIMIT_REACHED' ||
    code === 'UNAUTHORIZED' ||
    code === 'INVALID_INPUT' ||
    code === 'PROVIDER_ERROR'
  ) {
    return code;
  }
  return 'PROVIDER_ERROR';
}

async function readBody(source: unknown): Promise<InvokeResponse<never> | string | null> {
  if (!source) return null;
  if (typeof source === 'string') {
    try {
      return JSON.parse(source) as InvokeResponse<never>;
    } catch {
      return source;
    }
  }
  if (typeof source === 'object') {
    const record = source as Record<string, unknown>;
    if (record.error || record.data) return source as InvokeResponse<never>;
    const maybeResponse = source as { clone?: () => { text: () => Promise<string> }; text?: () => Promise<string>; json?: () => Promise<unknown> };
    try {
      if (typeof maybeResponse.clone === 'function') {
        const text = await maybeResponse.clone().text();
        try {
          return JSON.parse(text) as InvokeResponse<never>;
        } catch {
          return text;
        }
      }
      if (typeof maybeResponse.json === 'function') {
        return (await maybeResponse.json()) as InvokeResponse<never>;
      }
      if (typeof maybeResponse.text === 'function') {
        const text = await maybeResponse.text();
        try {
          return JSON.parse(text) as InvokeResponse<never>;
        } catch {
          return text;
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

function throwFromBody(body: InvokeResponse<never> | string | null, fallback: string): never {
  if (body && typeof body === 'object' && body.error) {
    throw new AiServiceError(asErrorCode(body.error.code), body.error.message ?? fallback);
  }
  if (typeof body === 'string' && body.trim()) {
    throw new AiServiceError('PROVIDER_ERROR', body.slice(0, 220));
  }
  throw new AiServiceError('PROVIDER_ERROR', fallback);
}

async function invokeAi<T>(action: AiAction, payload: unknown): Promise<T> {
  const session = await getSupabase().auth.getSession();
  const accessToken = session.data.session?.access_token;
  const { data, error, response } = await getSupabase().functions.invoke<InvokeResponse<T>>('ai', {
    body: { action, payload },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (error) {
    const status =
      response && typeof response === 'object' && 'status' in response
        ? Number((response as { status: number }).status)
        : 0;
    const fromResponse = await readBody(response ?? (error as { context?: unknown }).context);
    if (fromResponse) throwFromBody(fromResponse, error.message);
    if (status === 401) {
      throw new AiServiceError(
        'UNAUTHORIZED',
        'Kapı isteği kesiyor (401). Edge Functions → ai → Verify JWT’yi kapat, tekrar deploy et.',
      );
    }
    if (status === 404) {
      throw new AiServiceError(
        'AI_NOT_CONFIGURED',
        'ai fonksiyonu bulunamadı. Dashboard’da adı tam olarak ai olmalı.',
      );
    }
    const undeployed = /failed to send|not found|404|FunctionsFetchError/i.test(error.message);
    throw new AiServiceError(
      undeployed ? 'AI_NOT_CONFIGURED' : 'PROVIDER_ERROR',
      undeployed
        ? 'AI öğretmen henüz yayında değil. Supabase’te ai fonksiyonunu tekrar deploy et.'
        : `AI fonksiyonu ${status || 'hata'} döndü. Logs → API Gateway’de functions/v1/ai satırına bak.`,
    );
  }

  if (data?.error) {
    throw new AiServiceError(asErrorCode(data.error.code), data.error.message ?? 'AI isteği başarısız');
  }

  if (!data?.data) {
    throw new AiServiceError('PROVIDER_ERROR', 'AI yanıtı boş döndü');
  }

  return data.data;
}

export const AIService = {
  generateExplanation(input: ExplanationInput) {
    return invokeAi<ExplanationResult>('generateExplanation', input);
  },
  generateQuestion(input: GenerateQuestionInput) {
    return invokeAi<ExplanationResult>('generateQuestion', input);
  },
  analyzeAnswer(input: AnalyzeAnswerInput) {
    return invokeAi<ExplanationResult>('analyzeAnswer', input);
  },
  generateStudyPlan(input: StudyPlanInput) {
    return invokeAi<ExplanationResult>('generateStudyPlan', input);
  },
  analyzeWeakTopics(input: WeakTopicInput) {
    return invokeAi<ExplanationResult>('analyzeWeakTopics', input);
  },
  generateRevisionQuestions(input: RevisionInput) {
    return invokeAi<ExplanationResult>('generateRevisionQuestions', input);
  },
  solveImageQuestion(input: ImageQuestionInput) {
    return invokeAi<ExplanationResult>('solveImageQuestion', input);
  },
};
