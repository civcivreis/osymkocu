import { useQuery } from '@tanstack/react-query';

import { getSupabase } from '@/src/lib/supabase/client';
import { buildUpcomingSessions } from '@/src/lib/exams/sessions';
import type { Exam, ExamKind, ExamSession, Subject } from '@/src/lib/supabase/types';

export function useExams() {
  return useQuery({
    queryKey: ['exams'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('exams')
        .select('id, slug, name, kind');
      if (error) throw error;
      const order = ['tyt', 'ayt', 'tyt_ayt', 'kpss_ortaogretim', 'kpss_onlisans', 'kpss_lisans'];
      return ((data ?? []) as Exam[]).sort(
        (a, b) => order.indexOf(a.slug) - order.indexOf(b.slug),
      );
    },
  });
}

export function useSubjects(exam: Exam | null) {
  return useQuery({
    queryKey: ['subjects', exam?.id, exam?.kind],
    enabled: Boolean(exam),
    queryFn: async () => {
      if (!exam) return [] as Subject[];
      const supabase = getSupabase();

      if (exam.kind === 'tyt_ayt') {
        const { data: related, error: examError } = await supabase
          .from('exams')
          .select('id')
          .in('slug', ['tyt', 'ayt']);
        if (examError) throw examError;
        const ids = (related ?? []).map((row) => row.id);
        const { data, error } = await supabase
          .from('subjects')
          .select('id, exam_id, slug, name, sort_order')
          .in('exam_id', ids)
          .order('sort_order');
        if (error) throw error;
        return (data ?? []) as Subject[];
      }

      const { data, error } = await supabase
        .from('subjects')
        .select('id, exam_id, slug, name, sort_order')
        .eq('exam_id', exam.id)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as Subject[];
    },
  });
}

export function goalLabel(kind: ExamKind | undefined): string {
  if (kind === 'tyt' || kind === 'ayt' || kind === 'tyt_ayt') return 'Hedef net';
  return 'Hedef puan';
}

export function useExamSessions(exam: Exam | null) {
  return useQuery({
    queryKey: ['exam-sessions', exam?.id],
    enabled: Boolean(exam),
    queryFn: async () => {
      if (!exam) return [] as ExamSession[];
      const supabase = getSupabase();
      const listed = await supabase.rpc('list_exam_sessions', { p_exam_id: exam.id });
      if (!listed.error && listed.data?.length) {
        return listed.data as ExamSession[];
      }

      const stored = await supabase
        .from('exam_sessions')
        .select('id, exam_id, session_year, exam_date, label')
        .eq('exam_id', exam.id)
        .order('session_year');

      return buildUpcomingSessions(exam, (stored.data ?? []) as ExamSession[]);
    },
  });
}
