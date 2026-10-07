import { useEffect } from 'react';
import { View } from 'react-native';

import { ActionSheet } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { useFeedbackStore } from '@/src/components/ui/feedbackStore';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function FeedbackHost() {
  const { colors } = useAppTheme();
  const toast = useFeedbackStore((s) => s.toast);
  const confirm = useFeedbackStore((s) => s.confirm);
  const clearToast = useFeedbackStore((s) => s.clearToast);
  const clearConfirm = useFeedbackStore((s) => s.clearConfirm);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(clearToast, 2400);
    return () => clearTimeout(timer);
  }, [clearToast, toast]);

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 90 }}>
      {toast ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            bottom: 28,
            alignSelf: 'center',
            maxWidth: 420,
            marginHorizontal: 16,
            backgroundColor: toast.tone === 'error' ? colors.danger : toast.tone === 'success' ? colors.accent : colors.navy,
            borderRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}>
          <AppText variant="caption" tone="inverse" style={{ textAlign: 'center' }}>
            {toast.message}
          </AppText>
        </View>
      ) : null}
      <ActionSheet
        visible={Boolean(confirm)}
        title={confirm?.title}
        subtitle={confirm?.subtitle}
        onClose={clearConfirm}
        actions={
          confirm
            ? [
                {
                  key: 'confirm',
                  icon: confirm.danger ? 'trash-outline' : 'checkmark-outline',
                  label: confirm.confirmLabel ?? 'Tamam',
                  variant: confirm.danger ? 'destructive' : 'default',
                  onPress: confirm.onConfirm,
                },
              ]
            : []
        }
      />
    </View>
  );
}
