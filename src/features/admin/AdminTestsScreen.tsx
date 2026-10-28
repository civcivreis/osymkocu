import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminField, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { getSupabase } from '@/src/lib/supabase/client';

type PackageRow = {
  id: string;
  title: string;
  status: string;
  review_question_count: number;
  sort_order: number;
};

type QuestionRow = {
  id: string;
  lesson_id: string;
  question_text: string;
  correct_answer: string;
  question_type: string;
  lesson_title?: string;
};

export function AdminTestsScreen() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [title, setTitle] = useState('');
  const [count, setCount] = useState('5');

  const load = () => {
    void getSupabase()
      .from('lesson_packages')
      .select('id, title, status, review_question_count, sort_order')
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else setPackages((data ?? []) as PackageRow[]);
      });
    void getSupabase()
      .from('memory_lesson_questions')
      .select('id, lesson_id, question_text, correct_answer, question_type')
      .order('question_order', { ascending: true })
      .limit(80)
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else setQuestions((data ?? []) as QuestionRow[]);
      });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <View style={{ gap: 16 }}>
      <AppText variant="title">Testler</AppText>
      <AppText tone="muted">Paket tekrar testleri ve ders soruları. Öğrenci yalnızca yayındaki soruları görür.</AppText>

      <View style={adminCard}>
        <AppText variant="label">Yeni öğrenme paketi</AppText>
        <TextInput value={title} onChangeText={setTitle} placeholder="Paket adı (ör. İslamiyet Öncesi 1)" style={adminField} />
        <TextInput value={count} onChangeText={setCount} placeholder="Tekrar soru sayısı" style={adminField} />
        <Pressable
          onPress={() =>
            void getSupabase()
              .from('lesson_packages')
              .insert({
                title: title.trim() || 'Yeni paket',
                review_question_count: Number(count) || 5,
                status: 'draft',
              })
              .then(({ error }) => {
                if (error) toastError(mapAdminError(error.message));
                else {
                  toastSuccess('Paket oluşturuldu');
                  setTitle('');
                  load();
                }
              })
          }
          style={adminBtn}>
          <AppText tone="inverse">Paket oluştur</AppText>
        </Pressable>
      </View>

      {packages.map((row) => (
        <View key={row.id} style={adminCard}>
          <AppText variant="subtitle">{row.title}</AppText>
          <AppText variant="caption">
            {row.status} · tekrar {row.review_question_count} soru
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable
              onPress={() =>
                void getSupabase()
                  .from('lesson_packages')
                  .update({ status: row.status === 'published' ? 'draft' : 'published' })
                  .eq('id', row.id)
                  .then(() => load())
              }
              style={adminGhost}>
              <AppText>{row.status === 'published' ? 'Yayından al' : 'Yayınla'}</AppText>
            </Pressable>
            <Pressable
              onPress={() =>
                void getSupabase()
                  .from('lesson_packages')
                  .update({ status: 'archived' })
                  .eq('id', row.id)
                  .then(() => load())
              }
              style={adminGhost}>
              <AppText>Arşivle</AppText>
            </Pressable>
          </View>
        </View>
      ))}

      <AppText variant="subtitle">Ders soruları</AppText>
      {questions.map((row) => (
        <View key={row.id} style={adminCard}>
          <AppText>{row.question_text}</AppText>
          <AppText variant="caption">
            {row.lesson_title ?? 'Ders'} · doğru {row.correct_answer} · {row.question_type}
          </AppText>
          <Pressable onPress={() => router.push(`/admin/hafiza-dersleri/${row.lesson_id}?tab=sorular` as never)} style={adminGhost}>
            <AppText>Düzenle</AppText>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
