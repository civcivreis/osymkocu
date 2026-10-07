export type AiMode =
  | 'simple'
  | 'shortest'
  | 'detailed'
  | 'osym_tactic'
  | 'similar_question';

export type AiAction =
  | 'generateExplanation'
  | 'generateQuestion'
  | 'analyzeAnswer'
  | 'generateStudyPlan'
  | 'analyzeWeakTopics'
  | 'generateRevisionQuestions'
  | 'solveImageQuestion';

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'LIMIT_REACHED'
  | 'UNAUTHORIZED'
  | 'INVALID_INPUT'
  | 'PROVIDER_ERROR';

export class AiServiceError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ExplanationInput = {
  question: string;
  mode: AiMode;
  examSlug?: string;
  subject?: string;
  history?: ChatTurn[];
  appContext?: Record<string, unknown>;
  imageUrl?: string;
  imagePath?: string;
};

export type ExplanationResult = {
  kind?: 'chat' | 'lesson';
  reply?: string;
  answer: string;
  solution: string;
  shortMethod: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  commonMistake: string;
  osymTip?: string;
};

export type GenerateQuestionInput = {
  examSlug: string;
  subject: string;
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  count?: number;
};

export type AnalyzeAnswerInput = {
  question: string;
  userAnswer: string;
  correctAnswer?: string;
};

export type StudyPlanInput = {
  examSlug: string;
  targetScore: number;
  dailyMinutes: number;
  weakSubjects: string[];
  daysUntilExam: number;
};

export type WeakTopicInput = {
  examSlug: string;
  stats: Array<{ topic: string; accuracy: number; attempts: number }>;
};

export type RevisionInput = {
  topic: string;
  count: number;
  examSlug: string;
};

export type ImageQuestionInput = {
  imagePath?: string;
  imageBase64?: string;
  imageUrl?: string;
  mode: AiMode;
  history?: ChatTurn[];
  appContext?: Record<string, unknown>;
  question?: string;
};
