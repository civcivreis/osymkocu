import type { StudyPlan, StudyTask } from '@/src/lib/supabase/types';

import { taskSolvedCount } from './useDashboard';

type Attempt = {
  id: string;
  mode: string | null;
  questions: { subject_id: string } | { subject_id: string }[] | null;
};

export function coachCopy(input: {
  name: string;
  plan: StudyPlan | null;
  attempts: Attempt[];
  hour: number;
}): { headline: string; body: string; actionLabel: string | null; task: StudyTask | null } {
  const firstName = input.name.trim().split(' ')[0] || 'öğrenci';
  const tasks = input.plan?.study_tasks ?? [];
  const started = tasks
    .map((task) => ({ task, solved: taskSolvedCount(task, input.attempts) }))
    .filter((row) => row.solved > 0 && row.task.status !== 'completed' && row.solved < (row.task.question_count ?? 0));
  const allDone = tasks.length > 0 && tasks.every((task) => task.status === 'completed');
  const noneStarted = input.attempts.length === 0;

  if (allDone) {
    return {
      headline: `Bugün harika bir performans çıkardın, ${firstName}.`,
      body: 'Hedefin doldu. Şimdi güzelce dinlen, yarın görüşürüz.',
      actionLabel: null,
      task: null,
    };
  }

  if (started.length > 0) {
    const current = started[0];
    const left = (current.task.question_count ?? 0) - current.solved;
    const subject = current.task.title.replace(/ – .*$/, '');
    return {
      headline: `Bugünkü ${subject.toLocaleLowerCase('tr-TR')} hedefin yarım kaldı.`,
      body: `${current.solved}/${current.task.question_count} soru çözdün, ${left} kaldı. Pes etme, kaldığın yerden devam.`,
      actionLabel: 'Kaldığın yerden devam',
      task: current.task,
    };
  }

  if (noneStarted && tasks[0]) {
    const subject = tasks[0].title.replace(/ – .*$/, '');
    const night = input.hour >= 21;
    return {
      headline: night ? `${firstName}, gün bitmeden küçük bir set yeter.` : `${firstName}, bugün ${subject} seni bekliyor.`,
      body: night
        ? '10 soruluk bir tur bile serini korur. İstersen yarın da buradayım.'
        : 'Kutuya basmana gerek yok. Derse gir, çözdükçe burası kendi dolar.',
      actionLabel: 'Derse geç',
      task: tasks[0],
    };
  }

  return {
    headline: `${firstName}, bugün de yanındayım.`,
    body: `${input.attempts.length} soru çözdün. İstersen bir set daha, istersen yanlış defteri.`,
    actionLabel: 'Devam et',
    task: tasks.find((task) => task.status !== 'completed') ?? null,
  };
}

export function examCountdownLine(input: {
  examName: string | null;
  examDate: string | null;
  examYear: number | null;
  days: number | null;
}): string {
  if (input.examDate && input.days != null && input.days >= 0) {
    return `${input.examName ?? 'Sınav'} için ${input.days} gün kaldı.`;
  }
  if (input.examDate && input.days != null && input.days < 0) {
    return 'Bu oturumun tarihi geçmiş. Yeni yılı seçebilirsin.';
  }
  if (input.examYear) {
    return `${input.examName ?? 'Sınav'} ${input.examYear} · ÖSYM tarihi açıklanınca geri sayım burada durur.`;
  }
  return 'Sınavını seçince geri sayımı biz tutarız.';
}
