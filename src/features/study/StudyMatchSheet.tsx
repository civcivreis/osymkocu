import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { taggedName } from '@/src/features/social/identity';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export type StudyMatchSheetProps = {
  visible: boolean;
  variant: 'auto' | 'manual';
  userId: string;
  displayName: string;
  displayTag?: number | null;
  avatarUrl?: string | null;
  subjectName?: string | null;
  topicName?: string | null;
  waiting?: boolean;
  busy?: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onClose: () => void;
};

function givenName(name: string) {
  const trimmed = name.trim();
  return trimmed.split(/[\s#]/)[0] || trimmed || 'Öğrenci';
}

export function StudyMatchSheet({
  visible,
  variant,
  userId,
  displayName,
  displayTag,
  avatarUrl,
  subjectName,
  topicName,
  waiting,
  busy,
  onPrimary,
  onSecondary,
  onClose,
}: StudyMatchSheetProps) {
  const { colors, radius } = useAppTheme();
  const [peek, setPeek] = useState(false);
  const name = taggedName(displayName, displayTag);
  const short = givenName(displayName);
  const auto = variant === 'auto';

  useEffect(() => {
    if (!visible) setPeek(false);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable
          onPress={() => undefined}
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.lg,
            },
          ]}>
          <Pressable onPress={() => setPeek(true)} hitSlop={8} style={styles.photo}>
            <LetterAvatar id={userId} name={displayName} size={72} imageUrl={avatarUrl} />
          </Pressable>
          <AppText variant="subtitle" style={{ textAlign: 'center' }}>
            {name}
          </AppText>
          {auto ? (
            <AppText variant="caption" tone="accent">
              Birini buldum 👋
            </AppText>
          ) : null}
          <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {auto
              ? `${short} de şu anda seninle aynı ${topicName ? 'konuyu' : 'dersi'} çalışıyor.`
              : `${short} seninle birlikte çalışmak istiyor.`}
          </AppText>
          {subjectName ? (
            <AppText variant="label" style={{ marginTop: 4 }}>
              {subjectName}
            </AppText>
          ) : null}
          {topicName ? (
            <AppText variant="caption" tone="muted">
              {topicName}
            </AppText>
          ) : null}
          {waiting ? (
            <AppText variant="caption" tone="muted" style={{ marginTop: 8 }}>
              Karşı tarafın cevabı bekleniyor…
            </AppText>
          ) : (
            <>
              {auto ? (
                <AppText variant="caption" tone="muted" style={{ marginTop: 8 }}>
                  Birlikte çalışmak ister misin?
                </AppText>
              ) : null}
              <View style={styles.actions}>
                <Pressable
                  disabled={busy}
                  onPress={onSecondary}
                  style={[
                    styles.cta,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: radius.md,
                      opacity: busy ? 0.5 : 1,
                    },
                  ]}>
                  <AppText variant="label">{auto ? 'Şimdi değil' : 'Reddet'}</AppText>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={onPrimary}
                  style={[
                    styles.cta,
                    {
                      backgroundColor: colors.accent,
                      borderRadius: radius.md,
                      opacity: busy ? 0.5 : 1,
                    },
                  ]}>
                  <AppText variant="label" tone="inverse">
                    {auto ? 'Birlikte çalış' : 'Kabul et'}
                  </AppText>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
        {peek ? (
          <Pressable onPress={() => setPeek(false)} style={[styles.peekWrap, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.peek,
                { backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border },
              ]}>
              <LetterAvatar id={userId} name={displayName} size={88} imageUrl={avatarUrl} />
              <AppText variant="subtitle">{name}</AppText>
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  card: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 18,
    gap: 6,
    borderWidth: 1,
    shadowColor: '#142033',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  photo: {
    marginBottom: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    marginTop: 10,
  },
  cta: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  peekWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 48,
  },
  peek: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
    paddingHorizontal: 22,
    borderWidth: 1,
    minWidth: 160,
  },
});
