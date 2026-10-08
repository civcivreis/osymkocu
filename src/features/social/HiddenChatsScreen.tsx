import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { useHiddenConversations, useUnhideThread } from '@/src/features/social/useInbox';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function HiddenChatsScreen() {
  const { colors, radius } = useAppTheme();
  const hidden = useHiddenConversations();
  const restore = useUnhideThread();
  const rows = hidden.data ?? [];

  return (
    <Screen>
      <View style={{ gap: 14 }}>
        <Pressable onPress={() => router.back()}>
          <AppText tone="accent">← Mesajlar</AppText>
        </Pressable>
        <AppText variant="title">Gizlenen sohbetler</AppText>
        <AppText tone="muted">Gizlemek gruptan ayırmaz. Mesajlar silinmez.</AppText>
        {hidden.isLoading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
        {!hidden.isLoading && rows.length === 0 ? (
          <AppText tone="muted">Gizlenmiş sohbet yok.</AppText>
        ) : null}
        {rows.map((row) => (
          <View
            key={`${row.kind}:${row.thread_key}`}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 14,
              gap: 8,
            }}>
            <AppText variant="subtitle">{row.title}</AppText>
            <AppText variant="caption" tone="muted">
              {row.last_body ?? 'Henüz mesaj yok'}
            </AppText>
            <AppText variant="caption" tone="muted">
              Gizlenme: {String(row.hidden_at).slice(0, 16).replace('T', ' ')}
            </AppText>
            <Pressable
              onPress={() =>
                void restore.mutateAsync({ kind: row.kind, thread: row.thread_key }).then(
                  () => toastSuccess('Sohbet geri getirildi.'),
                  (error: unknown) => toastError(error),
                )
              }
              style={{
                alignSelf: 'flex-start',
                minHeight: 36,
                paddingHorizontal: 12,
                borderRadius: 12,
                justifyContent: 'center',
                backgroundColor: colors.accentMuted,
              }}>
              <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
                Geri Getir
              </AppText>
            </Pressable>
          </View>
        ))}
      </View>
    </Screen>
  );
}
