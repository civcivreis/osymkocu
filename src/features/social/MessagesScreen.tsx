import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { SegmentedTabs } from '@/src/components/ui/SegmentedTabs';
import { ChatScreen } from '@/src/features/social/ChatScreen';
import { ConversationMediaPanel } from '@/src/features/social/ConversationMediaPanel';
import { GroupChatScreen } from '@/src/features/social/GroupChatScreen';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { ConversationActionSheet, type ConversationSheetTarget } from '@/src/features/social/ConversationActionSheet';
import { InboxRow } from '@/src/features/social/InboxRow';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { PersonRow } from '@/src/features/social/SocialScreen';
import { taggedName } from '@/src/features/social/identity';
import {
  useHideThread,
  useInbox,
  useLeaveExamGroup,
  useMarkThreadRead,
  useToggleThreadMute,
  useToggleThreadPin,
  type InboxDm,
  type InboxGroup,
} from '@/src/features/social/useInbox';
import { useBlockUser, useGroupMembers, useMessages, usePeople, usePublicProfile, useReportUser, useGroupMessages } from '@/src/features/social/useSocial';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

type Filter = 'all' | 'unread' | 'pinned';

function matchesQuery(haystack: string, query: string) {
  if (!query) return true;
  return haystack.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR'));
}

function groupPreview(group: InboxGroup, me?: string) {
  if (!group.last_body) return 'Henüz mesaj yok';
  const mine = Boolean(me && group.last_sender_id === me);
  const who = mine ? 'Sen' : (group.last_sender_name ?? 'Öğrenci');
  return `${who}: ${group.last_body}`;
}

function dmPreview(item: InboxDm, me?: string) {
  if (item.accepted_at == null && item.initiated_by === me) return 'Karşı tarafın kabulü bekleniyor';
  if (item.accepted_at == null && item.initiated_by !== me) return 'İlk mesaj · kabul edersen konuşma açılır';
  return item.last_body ?? 'Sohbet';
}

export function MessagesScreen() {
  const { colors, spacing, radius } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const me = useAuthStore((s) => s.session?.user.id);
  const [tab, setTab] = useState<'groups' | 'dms'>('groups');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selectedDm, setSelectedDm] = useState<InboxDm | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<InboxGroup | null>(null);
  const people = usePeople(search);
  const inbox = useInbox();
  const pin = useToggleThreadPin();
  const mute = useToggleThreadMute();
  const markRead = useMarkThreadRead();
  const hide = useHideThread();
  const leaveGroup = useLeaveExamGroup();
  const blockUser = useBlockUser();
  const reportUser = useReportUser();
  const [sheet, setSheet] = useState<ConversationSheetTarget | null>(null);
  const query = search.trim();
  const selectedProfile = usePublicProfile(isDesktop ? selectedDm?.other_id ?? null : null);
  const groupMembers = useGroupMembers(isDesktop ? selectedGroup?.slug ?? null : null);
  const dmMessages = useMessages(isDesktop ? selectedDm?.conversation_id ?? null : null);
  const groupMessages = useGroupMessages(isDesktop ? selectedGroup?.slug ?? null : null);

  const groups = useMemo(() => {
    return (inbox.data?.groups ?? []).filter((item) => {
      if (filter === 'unread' && item.unread <= 0) return false;
      if (filter === 'pinned' && !item.is_pinned) return false;
      return matchesQuery(`${item.name} ${item.last_body ?? ''} ${item.last_sender_name ?? ''}`, query);
    });
  }, [filter, inbox.data?.groups, query]);

  const dms = useMemo(() => {
    return (inbox.data?.dms ?? []).filter((item) => {
      if (filter === 'unread' && item.unread <= 0) return false;
      if (filter === 'pinned' && !item.is_pinned) return false;
      return matchesQuery(`${item.other_name} ${item.last_body ?? ''}`, query);
    });
  }, [filter, inbox.data?.dms, query]);

  const live = (iso?: string | null) => {
    if (!iso) return false;
    return Date.now() - Date.parse(iso) < 8 * 60 * 1000;
  };

  const openGroupSheet = (group: InboxGroup) => {
    setSheet({
      kind: 'group',
      thread: group.slug,
      title: group.name,
      lastAt: group.last_at,
      avatarId: group.slug,
      avatarName: group.name,
      pinned: group.is_pinned,
      muted: group.is_muted,
      unread: group.unread,
    });
  };

  const openDmSheet = (item: InboxDm) => {
    setSheet({
      kind: 'dm',
      thread: item.conversation_id,
      title: taggedName(item.other_name, item.other_tag),
      lastAt: item.last_at,
      avatarId: item.other_id,
      avatarName: item.other_name,
      pinned: item.is_pinned,
      muted: item.is_muted,
      unread: item.unread,
      otherId: item.other_id,
    });
  };

  const run = (work: Promise<unknown>) => {
    setSheet(null);
    void work.then(undefined, (error: unknown) => {
      toastError(error);
    });
  };

  return (
    <Screen scroll={!isDesktop} safeEdges={['top']}>
      <View style={{ flex: 1, flexDirection: isDesktop ? 'row' : 'column', gap: isDesktop ? 12 : 0 }}>
      <View style={{ gap: spacing.md, paddingBottom: isDesktop ? 8 : 28, width: isDesktop ? 320 : undefined, flex: isDesktop ? undefined : 1 }}>
        <View style={{ gap: 4 }}>
          <AppText variant="display">Mesajlar</AppText>
          <AppText tone="muted">Yeni mesajlar üste çıkar. Okunmamışlar kırmızı rozetle durur.</AppText>
        </View>
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'groups', label: 'Gruplar' },
            { value: 'dms', label: 'Mesajlar' },
          ]}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            paddingHorizontal: 12,
          }}>
          <Ionicons name="search" size={18} color={colors.textSubtle} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Grup veya kişi ara"
            placeholderTextColor={colors.textSubtle}
            autoCorrect={false}
            style={{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 }}
          />
        </View>
        <Pressable onPress={() => router.push('/mesajlar/gizlenenler' as never)}>
          <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
            Gizlenen sohbetler
          </AppText>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(
            [
              { id: 'all', label: 'Tümü' },
              { id: 'unread', label: 'Okunmamış' },
              { id: 'pinned', label: 'Sabitlenenler' },
            ] as const
          ).map((item) => {
            const on = filter === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setFilter(item.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: on ? colors.accent : colors.border,
                  backgroundColor: on ? colors.accentMuted : colors.surface,
                }}>
                <AppText variant="label" tone={on ? 'accent' : 'muted'}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {tab === 'groups' ? (
          <View style={{ gap: 10 }}>
            {groups.map((group) => (
              <InboxRow
                key={group.slug}
                title={group.name}
                preview={groupPreview(group, me)}
                time={group.last_at}
                unread={group.unread}
                pinned={group.is_pinned}
                muted={group.is_muted}
                live={live(group.last_at)}
                avatarId={group.slug}
                avatarName={group.name}
                onPress={() => {
                  if (isDesktop) {
                    setTab('groups');
                    setSelectedGroup(group);
                    setSelectedDm(null);
                    return;
                  }
                  router.push({ pathname: '/group-chat', params: { slug: group.slug, name: group.name } });
                }}
                onLongPress={() => openGroupSheet(group)}
              />
            ))}
            {!inbox.isLoading && groups.length === 0 ? (
              <AppText tone="muted">
                {query || filter !== 'all'
                  ? 'Bu filtreye uyan grup yok.'
                  : 'Sınav grupların burada görünür. TYT, AYT ve KPSS odalarına otomatik katılırsın.'}
              </AppText>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {query.length >= 2
              ? (people.data ?? []).map((person) => <PersonRow key={person.id} person={person} />)
              : null}
            {dms.map((item) => (
              <InboxRow
                key={item.conversation_id}
                title={taggedName(item.other_name, item.other_tag)}
                preview={dmPreview(item, me)}
                time={item.last_at}
                unread={item.unread}
                pinned={item.is_pinned}
                muted={item.is_muted}
                live={live(item.last_at)}
                avatarId={item.other_id}
                avatarName={item.other_name}
                onAvatarPress={() => router.push({ pathname: '/user', params: { userId: item.other_id } })}
                onPress={() => {
                  if (isDesktop) {
                    setTab('dms');
                    setSelectedDm(item);
                    setSelectedGroup(null);
                    return;
                  }
                  router.push({
                    pathname: '/chat',
                    params: {
                      userId: item.other_id,
                      name: taggedName(item.other_name, item.other_tag),
                    },
                  });
                }}
                onLongPress={() => openDmSheet(item)}
              />
            ))}
            {!inbox.isLoading && dms.length === 0 && query.length < 2 ? (
              <AppText tone="muted">
                Henüz özel mesaj yok.{'\n'}Bir kullanıcıyla eşleştiğinde veya mesaj kabul ettiğinde burada görünecek.
              </AppText>
            ) : null}
          </View>
        )}
      </View>
      {isDesktop ? (
        <>
          <View style={{ flex: 1, minWidth: 0 }}>
            {tab === 'dms' && selectedDm ? (
              <ChatScreen peerId={selectedDm.other_id} embedded />
            ) : tab === 'groups' && selectedGroup ? (
              <GroupChatScreen groupSlug={selectedGroup.slug} groupName={selectedGroup.name} embedded />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <AppText tone="muted">Soldan bir sohbet seç.</AppText>
              </View>
            )}
          </View>
          {tab === 'dms' && selectedDm ? (
            <View
              style={{
                width: 280,
                borderLeftWidth: 1,
                borderLeftColor: colors.border,
                padding: 16,
                gap: 12,
              }}>
              <LetterAvatar id={selectedDm.other_id} name={selectedDm.other_name} size={72} />
              <AppText variant="subtitle">{taggedName(selectedDm.other_name, selectedDm.other_tag)}</AppText>
              {selectedProfile.data?.exam_name || selectedProfile.data?.bio ? (
                <AppText variant="caption" tone="muted">
                  {selectedProfile.data.exam_name ?? selectedProfile.data.bio}
                </AppText>
              ) : null}
              <Pressable onPress={() => router.push({ pathname: '/user', params: { userId: selectedDm.other_id } })}>
                <AppText tone="accent">Profili aç</AppText>
              </Pressable>
              <Pressable
                onPress={() =>
                  void blockUser.mutateAsync(selectedDm.other_id).then(undefined, (error: unknown) => toastError(error))
                }>
                <AppText tone="danger">Engelle</AppText>
              </Pressable>
              <Pressable
                onPress={() =>
                  void reportUser
                    .mutateAsync({ otherId: selectedDm.other_id, reason: 'other' })
                    .then(undefined, (error: unknown) => toastError(error))
                }>
                <AppText tone="muted">Şikayet et</AppText>
              </Pressable>
              <ConversationMediaPanel messages={dmMessages.data ?? []} />
            </View>
          ) : tab === 'groups' && selectedGroup ? (
            <View
              style={{
                width: 280,
                borderLeftWidth: 1,
                borderLeftColor: colors.border,
                padding: 16,
                gap: 12,
              }}>
              <AppText variant="subtitle">{selectedGroup.name}</AppText>
              <AppText variant="caption" tone="muted">
                {selectedGroup.member_count} üye
              </AppText>
              <AppText variant="label" tone="accent">
                ÜYELER
              </AppText>
              {(groupMembers.data ?? []).slice(0, 8).map((member) => (
                <Pressable
                  key={member.user_id}
                  onPress={() => router.push({ pathname: '/user', params: { userId: member.user_id } })}>
                  <AppText numberOfLines={1}>{taggedName(member.display_name, member.display_tag)}</AppText>
                </Pressable>
              ))}
              <AppText variant="caption" tone="muted">
                Sınav grubu sohbeti
              </AppText>
              <Pressable
                onPress={() =>
                  askConfirm({
                    title: 'Sohbeti gizle',
                    subtitle: 'Gruptan ayrılmadan sohbeti gizlemek istiyor musun?',
                    confirmLabel: 'Gizle',
                    onConfirm: () => {
                      void hide.mutateAsync({ kind: 'group', thread: selectedGroup.slug }).then(
                        () => toastSuccess('Sohbet gizlendi.'),
                        (error: unknown) => toastError(error),
                      );
                    },
                  })
                }>
                <AppText>Gizle</AppText>
              </Pressable>
              <ConversationMediaPanel messages={groupMessages.data ?? []} />
            </View>
          ) : null}
        </>
      ) : null}
      </View>
      <ConversationActionSheet
        target={sheet}
        onClose={() => setSheet(null)}
        onPin={() => {
          if (!sheet) return;
          run(pin.mutateAsync({ kind: sheet.kind, thread: sheet.thread }));
        }}
        onMute={() => {
          if (!sheet) return;
          run(mute.mutateAsync({ kind: sheet.kind, thread: sheet.thread }));
        }}
        onMarkRead={() => {
          if (!sheet) return;
          run(markRead.mutateAsync({ kind: sheet.kind, thread: sheet.thread }));
        }}
        onHide={() => {
          if (!sheet) return;
          askConfirm({
            title: 'Sohbeti gizle',
            subtitle: 'Gruptan ayrılmadan sohbeti gizlemek istiyor musun?',
            confirmLabel: 'Gizle',
            onConfirm: () => {
              void hide.mutateAsync({ kind: sheet.kind, thread: sheet.thread }).then(
                () => toastSuccess('Sohbet gizlendi.'),
                (error: unknown) => toastError(error),
              );
            },
          });
        }}
        onLeave={() => {
          if (!sheet) return;
          askConfirm({
            title: 'Gruptan ayrıl',
            subtitle: 'Üyeliğin kalkar. Mesajlar silinmez.',
            confirmLabel: 'Ayrıl',
            danger: true,
            onConfirm: () => run(leaveGroup.mutateAsync(sheet.thread)),
          });
        }}
        onBlock={() => {
          if (!sheet?.otherId) return;
          run(blockUser.mutateAsync(sheet.otherId));
        }}
        onDelete={() => {
          if (!sheet) return;
          askConfirm({
            title: 'Sohbeti gizle',
            subtitle: 'Sohbet gizlenir. Mesajlar silinmez.',
            confirmLabel: 'Gizle',
            onConfirm: () =>
              void hide.mutateAsync({ kind: 'dm', thread: sheet.thread }).then(
                () => toastSuccess('Sohbet gizlendi.'),
                (error: unknown) => toastError(error),
              ),
          });
        }}
      />
    </Screen>
  );
}
