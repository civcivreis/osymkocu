import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Screen } from '@/src/components/ui/Screen';
import { SegmentedTabs } from '@/src/components/ui/SegmentedTabs';
import { TextField } from '@/src/components/ui/TextField';
import { CreateRoomModal } from '@/src/features/social/CreateRoomModal';
import { FeedPostCard } from '@/src/features/social/FeedPostCard';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { StatusComposer } from '@/src/features/social/StatusComposer';
import { StoriesRail } from '@/src/features/social/StoriesRail';
import { taggedName, postedAt } from '@/src/features/social/identity';
import {
  useFriendships,
  useFriendXpBoard,
  useOpenRooms,
  usePeople,
  useRespondFriend,
  useSocialPosts,
  type OpenRoom,
} from '@/src/features/social/useSocial';
import { useJoinExamLobby } from '@/src/features/study/useStudyTogether';
import { useStudySubjects } from '@/src/features/study/usePractice';
import { useProgressInsights } from '@/src/features/progress/useProgressInsights';
import { useSystemExams } from '@/src/features/system-exams/useSystemExams';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

function roomLabel(mode: string) {
  if (mode === 'study') return 'Ders';
  if (mode === 'test') return 'Test';
  if (mode === 'exam') return 'Sınav';
  if (mode === 'race') return 'Yarışma';
  return 'Oda';
}

export function SocialScreen() {
  const { spacing, colors } = useAppTheme();
  const { isDesktop, isTablet } = useBreakpoint();
  const me = useAuthStore((s) => s.session?.user.id);
  const examId = useAuthStore((s) => s.profile?.exam_id);
  const autoMatch = useAuthStore((s) => s.profile?.auto_match) !== false;
  const [tab, setTab] = useState<'status' | 'rooms'>('status');
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const posts = useSocialPosts();
  const rooms = useOpenRooms();
  const people = usePeople('');
  const friendships = useFriendships();
  const board = useFriendXpBoard();
  const respond = useRespondFriend();
  const [createOpen, setCreateOpen] = useState(false);
  const subjects = useStudySubjects(examId ?? null);
  const upcomingExams = useSystemExams('upcoming');
  const insights = useProgressInsights();

  const incoming = useMemo(
    () => (friendships.data ?? []).filter((row) => row.addressee_id === me && row.status === 'pending'),
    [friendships.data, me],
  );
  const filteredRooms = useMemo(() => {
    const list = rooms.data ?? [];
    if (!subjectFilter) return list;
    return list.filter((room) => room.subject_id === subjectFilter);
  }, [rooms.data, subjectFilter]);

  if (isDesktop || isTablet) {
    return (
      <Screen scroll={false} safeEdges={['top']}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'stretch', gap: 16, minHeight: 0, overflow: 'hidden' }}>
          <ScrollView style={{ width: isDesktop ? 240 : 200 }} contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
            <AppText variant="label" tone="accent">
              DERS FİLTRESİ
            </AppText>
            <Pressable onPress={() => setSubjectFilter(null)} accessibilityRole="button" accessibilityLabel="Tüm dersler">
              <AppText tone={!subjectFilter ? 'accent' : 'muted'}>Tümü</AppText>
            </Pressable>
            {(subjects.data ?? []).slice(0, 12).map((subject) => (
              <Pressable key={subject.id} onPress={() => setSubjectFilter(subject.id)} accessibilityRole="button">
                <AppText tone={subjectFilter === subject.id ? 'accent' : 'muted'}>{subject.name}</AppText>
              </Pressable>
            ))}
            <AppText variant="label" tone="accent">
              AKTİF ODALAR
            </AppText>
            {filteredRooms.slice(0, 6).map((room) => (
              <JoinableRoomCard key={room.id} room={room} />
            ))}
            <AppText variant="caption" tone="muted">
              Eşleşme havuzu: {autoMatch ? 'Açık' : 'Kapalı'}
            </AppText>
            <Pressable onPress={() => setCreateOpen(true)} accessibilityRole="button">
              <AppText tone="accent">Oda kur</AppText>
            </Pressable>
          </ScrollView>
          <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ gap: 12, paddingBottom: 32, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
            <StoriesRail />
            <StatusComposer />
            {(posts.data ?? []).map((post) => (
              <FeedPostCard key={post.id} post={post} me={me} />
            ))}
          </ScrollView>
          {isDesktop ? (
            <ScrollView style={{ width: 280 }} contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
              <AppText variant="label" tone="accent">
                ÇALIŞILAN KONULAR
              </AppText>
              {(insights.data?.priorities ?? []).slice(0, 5).map((row) => (
                <AppText key={`${row.subject}-${row.topic}`} variant="caption">
                  {row.subject} → {row.topic}
                </AppText>
              ))}
              <AppText variant="label" tone="accent">
                ÖNERİLEN ÇALIŞMA ARKADAŞLARI
              </AppText>
              {(people.data ?? []).slice(0, 6).map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
              {(upcomingExams.data ?? [])[0] ? (
                <Card>
                  <AppText variant="label" tone="accent">
                    YAKLAŞAN SİSTEM SINAVI
                  </AppText>
                  <AppText>{upcomingExams.data![0].title}</AppText>
                  <Pressable onPress={() => router.push('/sistem-sinavlari')}>
                    <AppText tone="accent">Detay</AppText>
                  </Pressable>
                </Card>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
        <CreateRoomModal visible={createOpen} onClose={() => setCreateOpen(false)} />
      </Screen>
    );
  }

  return (
    <Screen scroll safeEdges={['top']}>
      <View style={{ gap: 12, paddingBottom: 28 }}>
        <View style={{ gap: 4 }}>
          <AppText variant="title">Sosyal</AppText>
          <AppText variant="caption" tone="muted">
            Story at, durum paylaş. Odada aynı soru düşer.
          </AppText>
        </View>

        <StoriesRail />

        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'status', label: 'Durum' },
            { value: 'rooms', label: 'Odalar' },
          ]}
        />
        {tab === 'rooms' && (rooms.data ?? []).length > 0 ? (
          <Pressable
            onPress={() => setCreateOpen(true)}
            style={{
              alignSelf: 'flex-end',
              minHeight: 32,
              paddingHorizontal: 12,
              borderRadius: 999,
              justifyContent: 'center',
              backgroundColor: colors.accentMuted,
            }}>
            <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              Oda kur
            </AppText>
          </Pressable>
        ) : null}

        <CreateRoomModal visible={createOpen} onClose={() => setCreateOpen(false)} />

        {tab === 'status' ? (
          <>
            <StatusComposer />

            {incoming.length > 0 ? (
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <AppText variant="label" tone="accent">
                    ARKADAŞ İSTEKLERİ
                  </AppText>
                  {incoming.map((row) => (
                    <View key={row.id} style={{ gap: 8 }}>
                      <AppText>{row.requester_name ?? 'Bir öğrenci'} arkadaş olmak istiyor.</AppText>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Kabul"
                            onPress={() => void respond.mutateAsync({ otherId: row.requester_id, accept: true })}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Reddet"
                            variant="ghost"
                            onPress={() => void respond.mutateAsync({ otherId: row.requester_id, accept: false })}
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}

            {(board.data ?? []).length > 1 ? (
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <AppText variant="label" tone="accent">
                    ARKADAŞ XP
                  </AppText>
                  {(board.data ?? []).slice(0, 5).map((row, index) => (
                    <Pressable
                      key={row.id}
                      onPress={() => {
                        if (row.id !== me) router.push({ pathname: '/user', params: { userId: row.id } });
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
                      <LetterAvatar id={row.id} name={row.display_name} size={32} />
                      <AppText>
                        {index + 1}. {row.id === me ? 'Sen' : row.display_name} · {row.current_xp} XP
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </Card>
            ) : null}

            <View style={{ gap: 8 }}>
              <View style={{ gap: 2 }}>
                <AppText variant="subtitle">Şimdi</AppText>
                <AppText variant="caption" tone="muted">
                  Topluluktaki son durumlar
                </AppText>
              </View>
              {posts.isLoading ? <AppText tone="muted">Akış yükleniyor…</AppText> : null}
              {posts.isError ? (
                <AppText tone="danger">Akış alınamadı. 0010_live_social.sql çalıştı mı?</AppText>
              ) : null}
              {(posts.data ?? []).map((post) => (
                <FeedPostCard key={post.id} post={post} me={me} />
              ))}
              {!posts.isLoading && (posts.data ?? []).length === 0 ? (
                <AppText tone="muted">Henüz durum yok. İlk cümleyi sen yaz.</AppText>
              ) : null}
            </View>

            <View style={{ gap: spacing.sm }}>
              <AppText variant="label" tone="accent">
                AYNI SINAV
              </AppText>
              {(people.data ?? []).slice(0, 8).map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
            </View>
          </>
        ) : (
          <View style={{ gap: 10 }}>
            {(rooms.data ?? []).length > 0 ? (
              <AppText variant="label" tone="accent">
                AÇIK ODALAR
              </AppText>
            ) : null}
            {rooms.isError ? <AppText tone="danger">Odalar alınamadı.</AppText> : null}
            {(rooms.data ?? []).map((room) => (
              <JoinableRoomCard key={room.id} room={room} />
            ))}
            {!rooms.isLoading && (rooms.data ?? []).length === 0 ? (
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 22,
                  paddingVertical: 22,
                  paddingHorizontal: 16,
                  alignItems: 'center',
                  gap: 10,
                  shadowColor: '#142033',
                  shadowOpacity: 0.04,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 1,
                }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: colors.accentMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Ionicons name="people-outline" size={24} color={colors.accent} />
                </View>
                <AppText variant="subtitle">Henüz açık oda yok</AppText>
                <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                  Bir ders seçip ilk çalışma odasını sen başlat.
                </AppText>
                <Pressable
                  onPress={() => setCreateOpen(true)}
                  style={{
                    minHeight: 40,
                    paddingHorizontal: 18,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.accent,
                    marginTop: 4,
                  }}>
                  <AppText variant="label" tone="inverse">
                    Oda oluştur
                  </AppText>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Screen>
  );
}

function roomIcon(mode: string, subject?: string | null): keyof typeof Ionicons.glyphMap {
  const key = `${mode} ${subject ?? ''}`.toLowerCase();
  if (key.includes('matematik')) return 'calculator-outline';
  if (key.includes('geometri')) return 'shapes-outline';
  if (key.includes('fizik')) return 'flash-outline';
  if (key.includes('kimya')) return 'flask-outline';
  if (key.includes('biyoloji')) return 'leaf-outline';
  if (key.includes('tarih')) return 'flag-outline';
  if (key.includes('coğraf') || key.includes('cograf')) return 'globe-outline';
  if (mode === 'test') return 'create-outline';
  if (mode === 'exam') return 'school-outline';
  if (mode === 'race') return 'trophy-outline';
  return 'book-outline';
}

function JoinableRoomCard({ room }: { room: OpenRoom }) {
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
        borderRadius: 20,
        padding: 12,
        gap: 8,
        shadowColor: '#142033',
        shadowOpacity: 0.04,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 14,
            backgroundColor: colors.accentMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Ionicons name={roomIcon(room.mode, room.subject_name)} size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="subtitle" numberOfLines={1}>
            {room.subject_name ?? room.title ?? roomLabel(room.mode)}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {topic ?? `${room.capacity} kişilik ${roomLabel(room.mode).toLowerCase()} odası`}
          </AppText>
          <AppText variant="caption" tone="subtle" numberOfLines={1}>
            {[
              full ? `${room.member_count}/${room.capacity} • Dolu` : `${room.member_count}/${room.capacity} kişi`,
              elapsed,
              room.chat_enabled === false ? 'Sohbet kapalı' : 'Sohbet açık',
              locked ? 'şifreli' : null,
            ]
              .filter(Boolean)
              .join(' • ')}
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
              {full ? 'Dolu' : joinExam.isPending ? '…' : 'Katıl'}
            </AppText>
          </Pressable>
        )}
      </View>
      {room.mode === 'race' ? (
        <AppText variant="caption" tone="muted">
          Yarışma davetle açılır.
        </AppText>
      ) : locked ? (
        <TextField
          label="Oda şifresi"
          value={password}
          onChangeText={setPassword}
          placeholder="Şifreyi yaz"
          secureTextEntry
        />
      ) : null}
    </View>
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
