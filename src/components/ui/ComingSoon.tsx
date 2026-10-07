import { View } from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { AppText } from './AppText';
import { Card } from './Card';

type Props = {
  title: string;
  description: string;
};

export function ComingSoon({ title, description }: Props) {
  const { spacing } = useAppTheme();

  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Card>
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label" tone="accent">
            YAKINDA
          </AppText>
          <AppText variant="title">{title}</AppText>
          <AppText tone="muted">{description}</AppText>
        </View>
      </Card>
    </View>
  );
}
