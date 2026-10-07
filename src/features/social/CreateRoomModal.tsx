import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { TextField } from '@/src/components/ui/TextField';
import { useStudySubjects } from '@/src/features/study/usePractice';
import { useCreateOpenRoom } from '@/src/features/study/useStudyTogether';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

type RoomKind = 'study' | 'test' | 'exam';
type Capacity = 2 | 5 | 10;

const KINDS: { value: RoomKind; icon: keyof typeof Ionicons.glyphMap; title: string; hint: string }[] = [
  { value: 'study', icon: 'book-outline', title: 'Ders', hint: 'Bir konuyu birlikte çalışın' },
  { value: 'test', icon: 'create-outline', title: 'Test', hint: 'Aynı testi birlikte çözün' },
  { value: 'exam', icon: 'timer-outline', title: 'Sınav', hint: 'Süreli deneme çözün' },
];

const CAPACITIES: { value: Capacity; title: string; hint: string }[] = [
  { value: 2, title: '2 kişi', hint: 'Küçük çalışma' },
  { value: 5, title: '5 kişi', hint: 'Grup çalışması' },
  { value: 10, title: '10 kişi', hint: 'Kalabalık oda' },
];

function subjectIcon(name: string): keyof typeof Ionicons.glyphMap {
  const n = name.toLocaleLowerCase('tr-TR');
  if (n.includes('türkçe') || n.includes('turkce')) return 'book';
  if (n.includes('geometri')) return 'triangle-outline';
  if (n.includes('matematik')) return 'calculator-outline';
  if (n.includes('fizik')) return 'flash-outline';
  if (n.includes('kimya')) return 'flask-outline';
  if (n.includes('biyoloji')) return 'leaf-outline';
  if (n.includes('tarih')) return 'business-outline';
  if (n.includes('coğrafya') || n.includes('cografya')) return 'earth-outline';
  if (n.includes('felsefe')) return 'bulb-outline';
  if (n.includes('din')) return 'library-outline';
  return 'bookmark-outline';
}

function kindWord(kind: RoomKind) {
  if (kind === 'test') return 'test';
  if (kind === 'exam') return 'sınav';
  return 'ders';
}

function kindEmoji(kind: RoomKind) {
  if (kind === 'test') return '📝';
  if (kind === 'exam') return '⏱';
  return '📚';
}

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function CreateRoomModal({ visible, onClose }: Props) {
  const { colors, spacing } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const examId = useAuthStore((s) => s.profile?.exam_id);
  const subjectsQuery = useStudySubjects(examId ?? null);
  const createRoom = useCreateOpenRoom();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [roomKind, setRoomKind] = useState<RoomKind>('study');
  const [examSize, setExamSize] = useState<Capacity>(5);
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(true);

  const subjects = subjectsQuery.data ?? [];
  const subject = subjects.find((item) => item.id === subjectId);
  const capacity = roomKind === 'exam' && examSize === 2 ? 5 : examSize;
  const kindLabel = kindWord(roomKind);
  const chatHint = chatEnabled ? 'Sohbet açık' : 'Sohbet kapalı';
  const lockHint = isPrivate ? 'Özel' : password.trim() ? 'Şifreli' : 'Açık';
  const summaryTitle = subject
    ? `${kindEmoji(roomKind)} ${title.trim() || `${subject.name} çalışma odası`}`
    : `${kindEmoji(roomKind)} Çalışma odası`;
  const cta = subject
    ? `${capacity} kişilik ${subject.name} ${kindLabel} odası oluştur`
    : 'Ders seçerek oda oluştur';

  const sheetHeight = Math.round(height * 0.82);

  const onCreate = () => {
    if (!subjectId) return;
    const pin =
      isPrivate && !password.trim() ? String(1000 + Math.floor(Math.random() * 9000)) : undefined;
    void createRoom
      .mutateAsync({
        subjectId,
        kind: roomKind,
        capacity,
        title: title.trim() || undefined,
        password: password.trim() || pin,
        isPrivate,
        chatEnabled,
      })
      .then(
        (sessionId) => {
          onClose();
          if (pin) {
            toastInfo(`Bu odaya katılmak için şifre: ${pin}`);
          }
          router.push({ pathname: '/study-room', params: { sessionId } });
        },
        (error: unknown) => toastError(error),
      );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => undefined}
            style={{
              height: sheetHeight,
              backgroundColor: colors.bg,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              overflow: 'hidden',
            }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                paddingHorizontal: spacing.screen,
                paddingTop: spacing.lg,
                paddingBottom: spacing.md,
                gap: 12,
              }}>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="title">Oda oluştur</AppText>
                <AppText variant="caption" tone="muted">
                  Çalışma türünü ve oda ayarlarını seç.
                </AppText>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.surfaceMuted,
                }}>
                <Ionicons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>
            <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: spacing.screen }} />

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: spacing.screen,
                paddingTop: 18,
                paddingBottom: 24,
                gap: 20,
              }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View style={{ gap: 10 }}>
                <AppText variant="subtitle">Ne yapacaksınız?</AppText>
                {KINDS.map((item) => {
                  const selected = roomKind === item.value;
                  return (
                    <Pressable
                      key={item.value}
                      onPress={() => {
                        setRoomKind(item.value);
                        if (item.value === 'exam' && examSize === 2) setExamSize(5);
                      }}
                      style={({ pressed }) => ({
                        minHeight: 72,
                        padding: 14,
                        borderRadius: 18,
                        borderWidth: 1.5,
                        borderColor: selected ? colors.accent : colors.border,
                        backgroundColor: selected ? colors.accentMuted : colors.surface,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                      })}>
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 14,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: selected ? colors.accent : colors.bgMuted,
                        }}>
                        <Ionicons
                          name={item.icon}
                          size={22}
                          color={selected ? colors.accentText : colors.text}
                        />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="subtitle" tone={selected ? 'accent' : 'primary'}>
                          {item.title}
                        </AppText>
                        <AppText variant="caption" tone="muted">
                          {item.hint}
                        </AppText>
                      </View>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ gap: 10 }}>
                <AppText variant="subtitle">Ders seç</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {subjects.map((item) => {
                    const selected = subjectId === item.id;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => setSubjectId(item.id)}
                        style={({ pressed }) => ({
                          width: '47.5%',
                          flexGrow: 1,
                          minHeight: 56,
                          paddingVertical: 12,
                          paddingHorizontal: 12,
                          borderRadius: 16,
                          borderWidth: 1.5,
                          borderColor: selected ? colors.accent : colors.border,
                          backgroundColor: selected ? colors.accentMuted : colors.surface,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                        })}>
                        <Ionicons
                          name={subjectIcon(item.name)}
                          size={18}
                          color={selected ? colors.accent : colors.textMuted}
                        />
                        <AppText
                          variant="caption"
                          tone={selected ? 'accent' : 'primary'}
                          style={{ fontWeight: '600', flex: 1 }}>
                          {item.name}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={{ gap: 10 }}>
                <AppText variant="subtitle">Oda kapasitesi</AppText>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {CAPACITIES.filter((item) => roomKind !== 'exam' || item.value !== 2).map((item) => {
                    const selected = capacity === item.value;
                    return (
                      <Pressable
                        key={item.value}
                        onPress={() => setExamSize(item.value)}
                        style={({ pressed }) => ({
                          flex: 1,
                          minHeight: 88,
                          padding: 10,
                          borderRadius: 16,
                          borderWidth: 1.5,
                          borderColor: selected ? colors.accent : colors.border,
                          backgroundColor: selected ? colors.accentMuted : colors.surface,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                          gap: 6,
                          alignItems: 'center',
                          justifyContent: 'center',
                        })}>
                        <Ionicons
                          name="people-outline"
                          size={20}
                          color={selected ? colors.accent : colors.textMuted}
                        />
                        <AppText variant="subtitle" tone={selected ? 'accent' : 'primary'}>
                          {item.title}
                        </AppText>
                        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                          {item.hint}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={{ gap: 12 }}>
                <AppText variant="subtitle">Oda ayarları</AppText>
                <TextField
                  label="Oda adı (isteğe bağlı)"
                  value={title}
                  onChangeText={setTitle}
                  placeholder={subject ? `${subject.name} çalışma odası` : 'Örn. Akşam matematik'}
                  autoCapitalize="sentences"
                  maxLength={48}
                />
                <TextField
                  label={isPrivate ? 'Oda şifresi' : 'Şifre (isteğe bağlı)'}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={isPrivate ? 'Boş bırakırsan otomatik üretilir' : 'Herkes açık odaya girebilir'}
                  secureTextEntry
                  autoCorrect={false}
                />
                <SettingRow
                  icon="lock-closed-outline"
                  title="Özel oda"
                  hint="Açıldığında yalnızca davet edilen kişiler katılabilir."
                  value={isPrivate}
                  onChange={setIsPrivate}
                />
                <SettingRow
                  icon="chatbubble-outline"
                  title="Sohbet"
                  hint="Oda içerisindeki yazılı sohbeti aç."
                  value={chatEnabled}
                  onChange={setChatEnabled}
                />
              </View>
            </ScrollView>

            <View
              style={{
                paddingHorizontal: spacing.screen,
                paddingTop: 12,
                paddingBottom: Math.max(insets.bottom, 12),
                backgroundColor: colors.bg,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                gap: 10,
              }}>
              <View
                style={{
                  padding: 12,
                  borderRadius: 16,
                  backgroundColor: colors.surface,
                  gap: 2,
                }}>
                <AppText variant="subtitle">{summaryTitle}</AppText>
                <AppText variant="caption" tone="muted">
                  {capacity} kişi • {kindLabel} • {lockHint} • {chatHint}
                </AppText>
              </View>
              <Pressable
                disabled={!subjectId || createRoom.isPending}
                onPress={onCreate}
                style={({ pressed }) => ({
                  minHeight: 56,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.accent,
                  opacity: !subjectId || createRoom.isPending ? 0.4 : pressed ? 0.9 : 1,
                  shadowColor: colors.accent,
                  shadowOpacity: 0.28,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 3,
                  transform: [{ scale: pressed && subjectId ? 0.99 : 1 }],
                  paddingHorizontal: 16,
                })}>
                <AppText variant="subtitle" tone="inverse" style={{ textAlign: 'center' }}>
                  {createRoom.isPending ? 'Kuruluyor…' : cta}
                </AppText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SettingRow({
  icon,
  title,
  hint,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { colors } = useAppTheme();
  const track = useMemo(
    () => ({ false: colors.bgMuted, true: colors.accentMuted }),
    [colors.accentMuted, colors.bgMuted],
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 64,
        padding: 12,
        borderRadius: 16,
        backgroundColor: colors.surface,
      }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bgMuted,
        }}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="subtitle">{title}</AppText>
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={track}
        thumbColor={value ? colors.accent : colors.surface}
      />
    </View>
  );
}
