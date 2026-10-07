import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import type { StudyTask } from '@/src/lib/supabase/types';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Props = {
  task: StudyTask;
  solved: number;
  onPress?: (task: StudyTask) => void;
};

export function TaskRow({ task, solved, onPress }: Props) {
  const { colors, radius, spacing } = useAppTheme();
  const target = task.question_count ?? 0;
  const done = task.status === 'completed' || (target > 0 && solved >= target);
  const shown = done ? target : Math.min(solved, target);

  return (
    <Pressable
      onPress={() => onPress?.(task)}
      style={{
        gap: 8,
        paddingVertical: 10,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: radius.sm,
            borderWidth: done ? 0 : 1.5,
            borderColor: colors.border,
            backgroundColor: done ? colors.accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {done ? (
            <AppText variant="caption" tone="inverse">
              ✓
            </AppText>
          ) : null}
        </View>
        <AppText style={{ flex: 1 }} tone={done ? 'muted' : 'primary'}>
          {task.title}
        </AppText>
        <AppText variant="caption" tone={done ? 'accent' : 'muted'}>
          {shown}/{target}
        </AppText>
      </View>
      <ProgressBar value={target > 0 ? shown / target : 0} />
    </Pressable>
  );
}
