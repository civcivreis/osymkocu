import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import {
    countdownLabel,
    examTypeLabel,
    formatIstanbulDateTime,
    type SystemExamListItem,
} from '@/src/features/system-exams/examTime';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function UpcomingExamCard({ exam }: { exam: SystemExamListItem }) {
  const { colors } = useAppTheme();
  const when = formatIstanbulDateTime(exam.start_at);
  return (
    <Pressable
      onPress={() => router.push('/system-exams')}
      style={{
        backgroundColor: colors.navy,
        borderRadius: 20,
        paddingVertical: 14,
        paddingHorizontal: 16,
        gap: 6,
      }}>
      <AppText variant="label" style={{ color: '#F3E0D4' }}>
        Sistem Sınavı
      </AppText>
      <AppText variant="subtitle" style={{ color: '#FFFcf7' }}>
        {exam.title}
      </AppText>
      <AppText variant="caption" style={{ color: '#E8E3D8' }}>
        {examTypeLabel(exam.exam_type)} · {when.label}
      </AppText>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="caption" style={{ color: '#F3E0D4' }}>
          {countdownLabel(exam.start_at)}
        </AppText>
        <AppText variant="label" style={{ color: '#F3E0D4' }}>
          Detay
        </AppText>
      </View>
    </Pressable>
  );
}
