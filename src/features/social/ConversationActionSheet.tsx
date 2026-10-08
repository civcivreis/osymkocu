import { ActionSheet, type ActionSheetItem } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { clockLabel } from '@/src/features/social/identity';
import { View } from 'react-native';

export type ConversationSheetTarget = {
  kind: 'group' | 'dm';
  thread: string;
  title: string;
  lastAt?: string | null;
  avatarId: string;
  avatarName: string;
  pinned: boolean;
  muted: boolean;
  unread: number;
  otherId?: string;
};

export function ConversationActionSheet({
  target,
  onClose,
  onPin,
  onMute,
  onMarkRead,
  onHide,
  onLeave,
  onBlock,
  onDelete,
}: {
  target: ConversationSheetTarget | null;
  onClose: () => void;
  onPin: () => void;
  onMute: () => void;
  onMarkRead: () => void;
  onHide: () => void;
  onLeave: () => void;
  onBlock: () => void;
  onDelete: () => void;
}) {
  const actions = target
    ? [
        {
          key: 'pin',
          icon: (target.pinned ? 'pin-outline' : 'pin') as ActionSheetItem['icon'],
          label: target.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle',
          hint: target.pinned ? 'Listede normal sıraya dönsün' : 'Listenin üstünde tut',
          onPress: onPin,
        },
        {
          key: 'mute',
          icon: (target.muted ? 'notifications-outline' : 'notifications-off-outline') as ActionSheetItem['icon'],
          label: target.muted ? 'Sessizi aç' : 'Sessize al',
          hint: target.muted ? 'Yeni mesaj bildirimlerini aç' : 'Yeni mesaj bildirimlerini kapat',
          onPress: onMute,
        },
        ...(target.unread > 0
          ? [
              {
                key: 'read',
                icon: 'checkmark-done-outline' as const,
                label: 'Okundu olarak işaretle',
                hint: 'Rozeti temizle',
                onPress: onMarkRead,
              },
            ]
          : []),
        {
          key: 'hide',
          icon: 'eye-off-outline' as ActionSheetItem['icon'],
          label: 'Gizle',
          hint: 'Sadece senin listenizden kalkar',
          onPress: onHide,
        },
        ...(target.kind === 'group'
          ? [
              {
                key: 'leave',
                icon: 'exit-outline' as const,
                label: 'Gruptan ayrıl',
                hint: 'Üyeliğin kalkar, mesajlar silinmez',
                danger: true,
                onPress: onLeave,
              },
            ]
          : [
              {
                key: 'block',
                icon: 'ban-outline' as const,
                label: 'Kullanıcıyı engelle',
                hint: 'Bu kişiyi bir daha görme',
                danger: true,
                onPress: onBlock,
              },
              {
                key: 'delete',
                icon: 'trash-outline' as const,
                label: 'Sohbeti sil',
                hint: 'Listeden kaldır',
                danger: true,
                onPress: onDelete,
              },
            ]),
      ]
    : [];

  return (
    <ActionSheet
      visible={Boolean(target)}
      onClose={onClose}
      actions={actions}
      header={
        target ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <LetterAvatar id={target.avatarId} name={target.avatarName} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="subtitle" numberOfLines={1}>
                {target.title}
              </AppText>
              <AppText variant="caption" tone="muted">
                {target.lastAt ? `Son mesaj: ${clockLabel(target.lastAt)}` : 'Henüz mesaj yok'}
              </AppText>
            </View>
          </View>
        ) : undefined
      }
    />
  );
}
