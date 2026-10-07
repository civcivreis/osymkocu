import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { ActionSheet } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export const REPORT_REASONS = [
  { id: 'kufur' as const, label: 'Küfür / hakaret' },
  { id: 'taciz' as const, label: 'Taciz' },
  { id: 'spam' as const, label: 'Spam' },
  { id: 'uygunsuz' as const, label: 'Uygunsuz içerik' },
  { id: 'diger' as const, label: 'Diğer' },
];

export const IMAGE_REPORT_REASONS = [
  { id: 'cinsel' as const, label: 'Cinsel içerik' },
  { id: 'taciz' as const, label: 'Taciz' },
  { id: 'siddet' as const, label: 'Şiddet' },
  { id: 'spam' as const, label: 'Spam' },
  { id: 'diger' as const, label: 'Diğer' },
];

export type ReportReasonId =
  | (typeof REPORT_REASONS)[number]['id']
  | (typeof IMAGE_REPORT_REASONS)[number]['id'];

export function ReportSheet({
  visible,
  title,
  onClose,
  onSubmit,
  reasons = REPORT_REASONS,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (reason: ReportReasonId) => void;
  reasons?: { id: ReportReasonId; label: string }[];
}) {
  return (
    <ActionSheet
      visible={visible}
      title={title}
      onClose={onClose}
      actions={reasons.map((item) => ({
        key: item.id,
        icon: 'flag-outline',
        label: item.label,
        onPress: () => onSubmit(item.id),
      }))}
    />
  );
}

export function EditPostSheet({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onSave: (body: string) => void;
}) {
  const { colors } = useAppTheme();
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (visible) setText(initial);
  }, [initial, visible]);
  return (
    <ActionSheet
      visible={visible}
      title="Düzenle"
      onClose={onClose}
      actions={[{ key: 'save', icon: 'checkmark-outline', label: 'Kaydet', onPress: () => onSave(text.trim()) }]}
      children={
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          style={{ minHeight: 80, color: colors.text, fontSize: 16, marginBottom: 8 }}
        />
      }
    />
  );
}

export function StudyInviteSheet({
  visible,
  title,
  subtitle,
  subjects,
  topics,
  pickedSubject,
  pickedTopic,
  onPickSubject,
  onPickTopic,
  onSend,
  sending,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  subjects: { id: string; name: string }[];
  topics: { id: string; name: string }[];
  pickedSubject: string | null;
  pickedTopic: string | null;
  onPickSubject: (id: string) => void;
  onPickTopic: (id: string) => void;
  onSend: () => void;
  sending?: boolean;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <ActionSheet
      visible={visible}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      actions={[
        {
          key: 'send',
          icon: 'paper-plane-outline',
          label: sending ? 'Gönderiliyor…' : 'İstek gönder',
          onPress: onSend,
        },
      ]}
      children={
        <View style={{ gap: 8, marginBottom: 8 }}>
          <AppText variant="caption" tone="muted">
            Ders
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {subjects.map((subject) => (
              <Pressable
                key={subject.id}
                onPress={() => onPickSubject(subject.id)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: pickedSubject === subject.id ? colors.accentMuted : colors.bgMuted,
                }}>
                <AppText variant="caption">{subject.name}</AppText>
              </Pressable>
            ))}
          </View>
          {topics.length > 0 ? (
            <>
              <AppText variant="caption" tone="muted">
                Konu
              </AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {topics.map((topic) => (
                  <Pressable
                    key={topic.id}
                    onPress={() => onPickTopic(topic.id)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: pickedTopic === topic.id ? colors.accentMuted : colors.bgMuted,
                    }}>
                    <AppText variant="caption">{topic.name}</AppText>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>
      }
    />
  );
}
