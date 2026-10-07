import { z } from 'zod';

export const onboardingSchema = z.object({
  examId: z.string().uuid('Sınav seç'),
  examKind: z.enum(['tyt', 'ayt', 'tyt_ayt', 'kpss_onlisans', 'kpss_lisans']),
  targetScore: z.number().min(50).max(500),
  examDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG olmalı')
    .nullable(),
  examYear: z.number().int().min(2026).max(2035),
  dailyMinutes: z.number().min(20).max(360),
  strongSubjectIds: z.array(z.string().uuid()),
  weakSubjectIds: z.array(z.string().uuid()),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;
