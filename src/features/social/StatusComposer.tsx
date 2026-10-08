import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { subjectGlyph, taggedName } from '@/src/features/social/identity';
import { usePublishPost } from '@/src/features/social/useSocial';
import { useStudySubjects } from '@/src/features/study/usePractice';
import { moderateContent } from '@/src/lib/moderation/profanity';
import { nativeDriver } from '@/src/lib/animation/nativeDriver';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

const IDEAS = ['Coğrafya çalışacak var mı?', 'Bugün 80 soru çözdüm', 'Deneme çözen var mı?'];
const DURATIONS: { minutes: 30 | 60 | 120 | 240; label: string }[] = [
  { minutes: 30, label: '30 dk' },
  { minutes: 60, label: '1 saat' },
  { minutes: 120, label: '2 saat' },
  { minutes: 240, label: '4 saat' },
];
const GOAL_CHIPS = ['20 soru', '40 soru', '80 soru'];

type Picker = 'subject' | 'duration' | 'goal' | null;

export function StatusComposer() {
  const { colors } = useAppTheme();
  const me = useAuthStore((s) => s.session?.user.id);
  const profile = useAuthStore((s) => s.profile);
  const subjectsQuery = useStudySubjects(profile?.exam_id ?? null);
  const publish = usePublishPost();
  const [draft, setDraft] = useState('');
  const [fromIdea, setFromIdea] = useState(false);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<30 | 60 | 120 | 240>(60);
  const [durationPicked, setDurationPicked] = useState(false);
  const [goal, setGoal] = useState('');
  const [picker, setPicker] = useState<Picker>(null);
  const panel = useRef(new Animated.Value(0)).current;

  const subjects = subjectsQuery.data ?? [];
  const subject = subjects.find((item) => item.id === subjectId);
  const duration = DURATIONS.find((item) => item.minutes === minutes);
  const showIdeas = !draft.trim() || fromIdea;
  const canPost = draft.trim().length >= 2 && !publish.isPending;
  const handle = taggedName(profile?.display_name, profile?.display_tag);

  useEffect(() => {
    Animated.timing(panel, { toValue: picker ? 1 : 0, duration: 160, useNativeDriver: nativeDriver }).start();
  }, [panel, picker]);

  const toggle = (next: Picker) => setPicker((current) => (current === next ? null : next));

  const onPublish = async () => {
    const body = draft.trim();
    if (!body || publish.isPending) return;
    if (moderateContent(body) === 'block') {
      toastInfo('Bu içerik topluluk kurallarına uygun değil.');
      return;
    }
    try {
      await publish.mutateAsync({
        body,
        subjectId,
        minutes: durationPicked ? minutes : undefined,
        intent: goal.trim() ? 'goal' : draft.toLowerCase().includes('soru') ? 'ask' : 'status',
        goal: goal.trim() || undefined,
      });
      setDraft('');
      setFromIdea(false);
      setSubjectId(null);
      setMinutes(60);
      setDurationPicked(false);
      setGoal('');
      setPicker(null);
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 22,
        padding: 12,
        gap: 10,
        width: '100%',
        alignSelf: 'stretch',
        shadowColor: '#142033',
        shadowOpacity: 0.06,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {me ? (
          <LetterAvatar id={me} name={profile?.display_name} size={36} imageUrl={profile?.avatar_url} />
        ) : null}
        <AppText variant="subtitle" style={{ fontSize: 16, flex: 1 }} numberOfLines={1}>
          {handle}
        </AppText>
      </View>

      <TextInput
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          setFromIdea(false);
        }}
        placeholder="Bugün ne çalışıyorsun?"
        placeholderTextColor={colors.textSubtle}
        multiline
        textAlignVertical="top"
        style={{ minHeight: 56, fontSize: 16, lineHeight: 22, color: colors.text, padding: 0 }}
      />

      {subject || durationPicked || goal.trim() ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {subject ? (
            <SelectedTag label={`${subjectGlyph(subject.name)} ${subject.name}`} onClear={() => setSubjectId(null)} />
          ) : null}
          {durationPicked && duration ? (
            <SelectedTag label={duration.label} onClear={() => setDurationPicked(false)} />
          ) : null}
          {goal.trim() ? <SelectedTag label={goal.trim()} onClear={() => setGoal('')} /> : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <ActionPlus label="Konu ekle" open={picker === 'subject'} onPress={() => toggle('subject')} />
        <ActionPlus label="Hedef ekle" open={picker === 'goal'} onPress={() => toggle('goal')} />
        <ActionPlus
          label="Soru paylaş"
          onPress={() => {
            setDraft((current) => current || 'Bu soruyu çözemedim, birlikte bakabilir miyiz?');
            toggle('subject');
          }}
        />
      </View>

      {picker ? (
        <Animated.View
          style={{
            opacity: panel,
            transform: [{ scale: panel.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
            maxHeight: 220,
            borderRadius: 16,
            backgroundColor: colors.bg,
            padding: 10,
          }}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {picker === 'subject' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {subjects.map((item) => {
                  const selected = subjectId === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        setSubjectId(item.id);
                        setPicker(null);
                      }}
                      style={{
                        width: '47.5%',
                        flexGrow: 1,
                        minHeight: 40,
                        borderRadius: 14,
                        paddingHorizontal: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        backgroundColor: selected ? colors.accentMuted : colors.surface,
                      }}>
                      <AppText variant="caption">{subjectGlyph(item.name)}</AppText>
                      <AppText variant="caption" tone={selected ? 'accent' : 'primary'} style={{ fontWeight: '600', flex: 1 }}>
                        {item.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {picker === 'duration' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {DURATIONS.map((item) => {
                  const selected = durationPicked && minutes === item.minutes;
                  return (
                    <Pressable
                      key={item.minutes}
                      onPress={() => {
                        setMinutes(item.minutes);
                        setDurationPicked(true);
                        setPicker(null);
                      }}
                      style={{
                        minHeight: 36,
                        paddingHorizontal: 14,
                        borderRadius: 999,
                        justifyContent: 'center',
                        backgroundColor: selected ? colors.accentMuted : colors.surface,
                      }}>
                      <AppText variant="caption" tone={selected ? 'accent' : 'primary'} style={{ fontWeight: '600' }}>
                        {item.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            {picker === 'goal' ? (
              <View style={{ gap: 10 }}>
                <TextInput
                  value={goal}
                  onChangeText={setGoal}
                  placeholder="Örn. 40 soru"
                  placeholderTextColor={colors.textSubtle}
                  style={{ minHeight: 40, borderRadius: 12, paddingHorizontal: 12, color: colors.text, backgroundColor: colors.surface }}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {GOAL_CHIPS.map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => {
                        setGoal(item);
                        setPicker(null);
                      }}
                      style={{
                        minHeight: 36,
                        paddingHorizontal: 12,
                        borderRadius: 999,
                        justifyContent: 'center',
                        backgroundColor: goal === item ? colors.accentMuted : colors.surface,
                      }}>
                      <AppText variant="caption" tone={goal === item ? 'accent' : 'muted'}>
                        {item}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      ) : null}

      {showIdeas ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {IDEAS.map((item) => (
            <Pressable
              key={item}
              onPress={() => {
                setDraft(item);
                setFromIdea(true);
              }}
              style={{
                minHeight: 32,
                paddingHorizontal: 12,
                borderRadius: 999,
                justifyContent: 'center',
                backgroundColor: draft === item ? colors.accentMuted : colors.bgMuted,
              }}>
              <AppText variant="caption" tone={draft === item ? 'accent' : 'muted'}>
                {item}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <Pressable
        disabled={!canPost}
        onPress={() => void onPublish()}
        style={({ pressed }) => ({
          minHeight: 44,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.accent,
          opacity: canPost ? (pressed ? 0.9 : 1) : 0.4,
        })}>
        <AppText variant="label" tone="inverse">
          {publish.isPending ? 'Paylaşılıyor…' : 'Paylaş →'}
        </AppText>
      </Pressable>
    </View>
  );
}

function SelectedTag({ label, onClear }: { label: string; onClear: () => void }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 32,
        paddingLeft: 12,
        paddingRight: 6,
        borderRadius: 999,
        backgroundColor: colors.accentMuted,
        gap: 4,
      }}>
      <AppText variant="caption" tone="accent" style={{ fontWeight: '600' }}>
        {label}
      </AppText>
      <Pressable onPress={onClear} hitSlop={8} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={14} color={colors.accent} />
      </Pressable>
    </View>
  );
}

function ActionPlus({ label, open, onPress }: { label: string; open?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: 999,
        justifyContent: 'center',
        backgroundColor: open ? colors.accentMuted : colors.bgMuted,
      }}>
      <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
        {open ? '−' : '+'} {label}
      </AppText>
    </Pressable>
  );
}
