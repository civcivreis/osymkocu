import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, View, type ViewStyle } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Screen } from '@/src/components/ui/Screen';
import { TextField } from '@/src/components/ui/TextField';
import { toastError } from '@/src/components/ui/feedbackStore';
import { WeeklyXpCard } from '@/src/features/progress/WeeklyXpCard';
import { CreateRoomModal } from '@/src/features/social/CreateRoomModal';
import { FeedPostCard } from '@/src/features/social/FeedPostCard';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { StudyInviteSheet } from '@/src/features/social/ReportSheet';
import { StatusComposer } from '@/src/features/social/StatusComposer';
import { StoriesRail } from '@/src/features/social/StoriesRail';
import { taggedName, postedAt } from '@/src/features/social/identity';
import {
  useActiveStudyTopics,
  useFriendships,
  useOpenRooms,
  useRecommendedPartners,
  useRespondFriend,
  useSocialPosts,
  type ActiveStudyTopic,
  type OpenRoom,
  type RecommendedPartner,
} from '@/src/features/social/useSocial';
import { useJoinExamLobby, useRequestStudy } from '@/src/features/study/useStudyTogether';
import { useStudySubjects, useSubjectTopics } from '@/src/features/study/usePractice';
import { getSupabase } from '@/src/lib/supabase/client';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

function roomLabel(mode: string) {
  if (mode === 'study') return 'Ders';
  if (mode === 'test') return 'Test';
  if (mode === 'exam') return 'Sınav';
  if (mode === 'race') return 'Yarışma';
  return 'Oda';
}

export function SocialScreen() {
  const { colors, radius } = useAppTheme();
  const { width } = useBreakpoint();
  const params = useLocalSearchParams<{
    canonicalTopicId?: string;
    learningObjectiveId?: string;
    lessonId?: string;
    subjectId?: string;
    topicId?: string;
  }>();
  const me = useAuthStore((s) => s.session?.user.id);
  const profile = useAuthStore((s) => s.profile);
  const examId = profile?.exam_id;
  const autoMatch = profile?.auto_match !== false;
  const [subjectFilter, setSubjectFilter] = useState<string | null>(params.subjectId ?? null);
  const [topicFilter, setTopicFilter] = useState<string | null>(params.topicId ?? null);
  const [canonicalFilter, setCanonicalFilter] = useState<string | null>(params.canonicalTopicId ?? null);
  const posts = useSocialPosts();
  const rooms = useOpenRooms();
  const friendships = useFriendships();
  const respond = useRespondFriend();
  const [createOpen, setCreateOpen] = useState(false);
  const subjects = useStudySubjects(examId ?? null);
  const topics = useActiveStudyTopics();
  const partners = useRecommendedPartners({
    topicId: topicFilter,
    subjectId: subjectFilter,
    canonicalTopicId: canonicalFilter,
    learningObjectiveId: params.learningObjectiveId ?? null,
  });
  const threeCol = width >= 1200;
  const twoCol = width >= 900 && width < 1200;
  const [filtersOpen, setFiltersOpen] = useState(false);

  const incoming = useMemo(
    () => (friendships.data ?? []).filter((row) => row.addressee_id === me && row.status === 'pending'),
    [friendships.data, me],
  );

  const filteredPosts = useMemo(() => {
    return (posts.data ?? []).filter((post) => {
      if (subjectFilter && post.subject_id !== subjectFilter) return false;
      if (topicFilter && post.topic_id !== topicFilter) return false;
      if (canonicalFilter && post.canonical_topic_id !== canonicalFilter) return false;
      return true;
    });
  }, [canonicalFilter, posts.data, subjectFilter, topicFilter]);

  const filteredRooms = useMemo(() => {
    const list = rooms.data ?? [];
    if (subjectFilter) return list.filter((room) => room.subject_id === subjectFilter);
    return list;
  }, [rooms.data, subjectFilter]);

  const setMatch = async (value: boolean) => {
    if (!profile) return;
    const previous = profile;
    useAuthStore.getState().setProfile({ ...profile, auto_match: value });
    const { error } = await getSupabase().from('profiles').update({ auto_match: value }).eq('id', profile.id);
    if (error) useAuthStore.getState().setProfile(previous);
    if (!value) await getSupabase().rpc('leave_presence');
  };

  const onTopic = (row: ActiveStudyTopic) => {
    setCanonicalFilter(row.canonical_topic_id ?? null);
    setTopicFilter(row.topic_id ?? null);
  };

  const left = (
    <View style={{ gap: 12, width: '100%' }}>
      <Card>
        <View style={{ gap: 10 }}>
          <AppText variant="label" tone="accent">
            DERS FİLTRESİ
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <FilterChip label="Tümü" on={!(subjectFilter || topicFilter || canonicalFilter)} onPress={() => { setSubjectFilter(null); setTopicFilter(null); setCanonicalFilter(null); }} />
            {(subjects.data ?? []).slice(0, 10).map((subject) => (
              <FilterChip
                key={subject.id}
                label={subject.name}
                on={subjectFilter === subject.id}
                onPress={() => {
                  setSubjectFilter(subject.id);
                  setTopicFilter(null);
                }}
              />
            ))}
          </View>
        </View>
      </Card>
      <Card>
        <View style={{ gap: 10 }}>
          <AppText variant="label" tone="accent">
            AKTİF ODALAR
          </AppText>
          {filteredRooms.slice(0, 5).length === 0 ? (
            <AppText variant="caption" tone="muted">Henüz açık oda yok.</AppText>
          ) : (
            filteredRooms.slice(0, 5).map((room) => <JoinableRoomCard key={room.id} room={room} compact />)
          )}
          <Pressable
            onPress={() => setCreateOpen(true)}
            style={{
              minHeight: 40,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <AppText variant="label">Çalışma Odası Kur</AppText>
          </Pressable>
        </View>
      </Card>
      <Card>
        <View style={{ gap: 10 }}>
          <AppText variant="caption">Eşleşme havuzu: {autoMatch ? 'Açık' : 'Kapalı'}</AppText>
          <Pressable
            onPress={() => void setMatch(!autoMatch)}
            style={{
              minHeight: 40,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: autoMatch ? colors.accentMuted : colors.accent,
            }}>
            <AppText variant="label" tone={autoMatch ? 'accent' : 'inverse'}>
              {autoMatch ? 'Eşleşmeyi Kapat' : 'Eşleşmeyi Aç'}
            </AppText>
          </Pressable>
          {autoMatch ? (
            <AppText variant="caption" tone="muted">
              Şu anda eşleşme arıyorsun
            </AppText>
          ) : null}
        </View>
      </Card>
    </View>
  );

  const feed = (
    <View style={{ gap: 12, width: '100%', alignSelf: 'stretch', minWidth: 0 }}>
      <StoriesRail />
      <StatusComposer />
      {autoMatch ? (
        <Card>
          <AppText variant="caption">Eşleşme havuzu açık. Uygun bir öğrenci bulunursa “Birini buldum” kartı açılır.</AppText>
        </Card>
      ) : null}
      {incoming.length > 0 ? (
        <Card>
          <View style={{ gap: 8 }}>
            <AppText variant="label" tone="accent">
              ARKADAŞ İSTEKLERİ
            </AppText>
            {incoming.map((row) => (
              <View key={row.id} style={{ gap: 8 }}>
                <AppText>{row.requester_name ?? 'Bir öğrenci'} arkadaş olmak istiyor.</AppText>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button label="Kabul" onPress={() => void respond.mutateAsync({ otherId: row.requester_id, accept: true })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Reddet" variant="ghost" onPress={() => void respond.mutateAsync({ otherId: row.requester_id, accept: false })} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      {posts.isLoading ? <AppText tone="muted">Akış yükleniyor…</AppText> : null}
      {filteredPosts.length === 0 && !posts.isLoading ? (
        <EmptyState icon="chatbubble-ellipses-outline" title="Henüz paylaşım yok." body="İlk çalışma durumunu sen paylaş." />
      ) : (
        filteredPosts.map((post) => <FeedPostCard key={post.id} post={post} me={me} />)
      )}
    </View>
  );

  const topicRows = topics.data ?? [];
  const partnerRows = partners.data ?? [];

  const right = (
    <View style={{ gap: 14, width: '100%' }}>
      <Card>
        <View style={{ gap: 8 }}>
          <AppText variant="label" tone="accent">
            ÇALIŞILAN KONULAR
          </AppText>
          {topics.isLoading ? <AppText variant="caption" tone="muted">Yükleniyor…</AppText> : null}
          {!topics.isLoading && topicRows.length === 0 ? (
            <AppText variant="caption" tone="muted">
              Henüz aktif konu yok.
            </AppText>
          ) : null}
          {topicRows.slice(0, 5).map((row) => (
            <Pressable
              key={row.id}
              onPress={() => onTopic(row)}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: 8,
                paddingVertical: 6,
                borderRadius: radius.md,
                backgroundColor:
                  canonicalFilter === row.canonical_topic_id || topicFilter === row.topic_id ? colors.accentMuted : 'transparent',
              }}>
              <AppText variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                {row.name}
              </AppText>
              <AppText variant="caption" tone="muted">
                {row.people} kişi
              </AppText>
            </Pressable>
          ))}
        </View>
      </Card>
      <Card>
        <View style={{ gap: 8 }}>
          <AppText variant="label" tone="accent">
            ÖNERİLEN ÇALIŞMA ARKADAŞLARI
          </AppText>
          {partners.isLoading ? <AppText variant="caption" tone="muted">Yükleniyor…</AppText> : null}
          {!partners.isLoading && partnerRows.length === 0 ? (
            <AppText variant="caption" tone="muted">
              Şu anda uygun çalışma arkadaşı bulunamadı.
            </AppText>
          ) : null}
          {partnerRows.slice(0, 5).map((person) => (
            <PartnerCard key={person.user_id} person={person} />
          ))}
        </View>
      </Card>
      <WeeklyXpCard compact />
    </View>
  );

  const desktopGrid = Platform.OS === 'web'
    ? ({
        display: 'grid',
        gridTemplateColumns: '220px minmax(560px, 1fr) 300px',
        columnGap: 24,
        width: '100%',
        alignItems: 'start',
      } as unknown as ViewStyle)
    : null;

  const shell = threeCol ? (
    <View style={[{ width: '100%', minWidth: 0 }, desktopGrid ?? { flexDirection: 'row', gap: 24, alignItems: 'flex-start' }]}>
      <View style={{ width: desktopGrid ? undefined : 220, flexShrink: 0 }}>{left}</View>
      <View style={{ minWidth: 0, width: '100%', flexGrow: 1, maxWidth: desktopGrid ? undefined : 760 }}>{feed}</View>
      <View style={{ width: desktopGrid ? undefined : 300, flexShrink: 0 }}>{right}</View>
    </View>
  ) : twoCol ? (
    <View style={{ width: '100%', gap: 16 }}>
      <Pressable
        onPress={() => setFiltersOpen((open) => !open)}
        style={{
          alignSelf: 'flex-start',
          minHeight: 40,
          paddingHorizontal: 14,
          borderRadius: 12,
          justifyContent: 'center',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}>
        <AppText variant="label">{filtersOpen ? 'Filtreleri gizle' : 'Ders filtresi'}</AppText>
      </Pressable>
      {filtersOpen ? left : null}
      <View style={{ flexDirection: 'row', gap: 20, width: '100%', alignItems: 'flex-start' }}>
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, width: '100%' }}>{feed}</View>
        <View style={{ width: 300, flexShrink: 0 }}>{right}</View>
      </View>
    </View>
  ) : (
    <View style={{ gap: 14, width: '100%' }}>
      {feed}
      {left}
      {right}
    </View>
  );

  return (
    <Screen scroll safeEdges={['top']} wide style={{ paddingTop: 12 }}>
      {shell}
      <CreateRoomModal visible={createOpen} onClose={() => setCreateOpen(false)} />
    </Screen>
  );
}

export function PersonRow({
  person,
}: {
  person: {
    id: string;
    display_name: string;
    display_tag?: number | null;
    current_xp: number;
    exam_year: number | null;
    target_score: number | null;
  };
}) {
  const subtitle = [
    person.exam_year ? `${person.exam_year} oturumu` : null,
    person.target_score != null ? `hedef ${person.target_score}` : null,
    `${person.current_xp} XP`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable onPress={() => router.push({ pathname: '/user', params: { userId: person.id } })}>
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <LetterAvatar id={person.id} name={person.display_name} />
          <View style={{ gap: 4, flex: 1 }}>
            <AppText variant="subtitle">{taggedName(person.display_name, person.display_tag)}</AppText>
            <AppText variant="caption" tone="muted">
              {subtitle}
            </AppText>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: on ? colors.accentMuted : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}>
      <AppText variant="caption" tone={on ? 'accent' : 'primary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function PartnerCard({ person }: { person: RecommendedPartner }) {
  const { colors, radius } = useAppTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6 }}>
      <Pressable onPress={() => router.push({ pathname: '/user', params: { userId: person.user_id } })} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <LetterAvatar id={person.user_id} name={person.display_name} size={36} imageUrl={person.avatar_url} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText numberOfLines={1}>{taggedName(person.display_name, person.display_tag)}</AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {[person.exam_name, person.subject_name, person.topic_name].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </Pressable>
      {person.reason ? (
        <AppText variant="caption" tone="muted">
          {person.reason}
        </AppText>
      ) : null}
      <Pressable
        onPress={() => setOpen(true)}
        style={{ minHeight: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentMuted }}>
        <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
          Birlikte Çalış
        </AppText>
      </Pressable>
      <TogetherSheet
        visible={open}
        otherId={person.user_id}
        subjectId={person.subject_id}
        topicId={person.topic_id}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

function TogetherSheet({
  visible,
  otherId,
  subjectId,
  topicId,
  onClose,
}: {
  visible: boolean;
  otherId: string;
  subjectId?: string | null;
  topicId?: string | null;
  onClose: () => void;
}) {
  const examId = useAuthStore((s) => s.profile?.exam_id);
  const subjects = useStudySubjects(examId ?? null);
  const [pickedSubject, setPickedSubject] = useState(subjectId ?? null);
  const [pickedTopic, setPickedTopic] = useState(topicId ?? null);
  const topics = useSubjectTopics(pickedSubject);
  const study = useRequestStudy();

  return (
    <StudyInviteSheet
      visible={visible}
      title="Birlikte çalış"
      subtitle="Mevcut davet sistemi kullanılır."
      subjects={(subjects.data ?? []).map((row) => ({ id: row.id, name: row.name }))}
      topics={(topics.data ?? []).map((row) => ({ id: row.id, name: row.name }))}
      pickedSubject={pickedSubject}
      pickedTopic={pickedTopic}
      onPickSubject={(id) => {
        setPickedSubject(id);
        setPickedTopic(null);
      }}
      onPickTopic={setPickedTopic}
      sending={study.isPending}
      onClose={onClose}
      onSend={() => {
        if (!pickedSubject) return;
        void study
          .mutateAsync({ otherId, subjectId: pickedSubject, topicId: pickedTopic })
          .then(onClose, (error: unknown) => toastError(error));
      }}
    />
  );
}

function roomIcon(mode: string, subject?: string | null): keyof typeof Ionicons.glyphMap {
  const key = `${mode} ${subject ?? ''}`.toLowerCase();
  if (key.includes('matematik')) return 'calculator-outline';
  if (key.includes('tarih')) return 'flag-outline';
  if (key.includes('coğraf') || key.includes('cograf')) return 'globe-outline';
  if (mode === 'test') return 'create-outline';
  if (mode === 'exam') return 'school-outline';
  return 'book-outline';
}

function JoinableRoomCard({ room, compact }: { room: OpenRoom; compact?: boolean }) {
  const { colors } = useAppTheme();
  const joinExam = useJoinExamLobby();
  const [password, setPassword] = useState('');
  const locked = Boolean(room.has_password);
  const topic = room.title && room.title !== room.subject_name ? room.title : null;
  const full = room.member_count >= room.capacity;
  const elapsed = room.created_at ? postedAt(room.created_at) : null;

  const onJoin = () => {
    if (full) return;
    void joinExam
      .mutateAsync({ sessionId: room.id, password: password.trim() || undefined })
      .then(
        () => router.push({ pathname: '/study-room', params: { sessionId: room.id } }),
        (error: unknown) => toastError(error),
      );
  };

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: compact ? 10 : 12,
        gap: 8,
        borderWidth: 1,
        borderColor: colors.border,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            backgroundColor: colors.accentMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Ionicons name={roomIcon(room.mode, room.subject_name)} size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="subtitle" numberOfLines={1} style={{ fontSize: 15 }}>
            {topic ?? room.subject_name ?? room.title ?? roomLabel(room.mode)}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {full ? `${room.member_count}/${room.capacity} • Dolu` : `${room.member_count}/${room.capacity} kişi`}
            {elapsed ? ` · ${elapsed}` : ''}
          </AppText>
        </View>
        {room.mode === 'race' ? null : (
          <Pressable
            onPress={onJoin}
            disabled={full || joinExam.isPending || (locked && !password.trim())}
            style={{
              minHeight: 32,
              paddingHorizontal: 12,
              borderRadius: 999,
              justifyContent: 'center',
              backgroundColor: colors.accentMuted,
              opacity: full || joinExam.isPending || (locked && !password.trim()) ? 0.45 : 1,
            }}>
            <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              {full ? 'Dolu' : locked ? 'İstek Gönder' : joinExam.isPending ? '…' : 'Katıl'}
            </AppText>
          </Pressable>
        )}
      </View>
      {locked ? (
        <TextField label="Oda şifresi" value={password} onChangeText={setPassword} placeholder="Şifreyi yaz" secureTextEntry />
      ) : null}
    </View>
  );
}
