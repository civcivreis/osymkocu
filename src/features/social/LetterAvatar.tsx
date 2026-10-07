import { Image, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { avatarColor, avatarLetter } from '@/src/features/social/identity';

type Props = {
  id: string;
  name?: string | null;
  size?: number;
  imageUrl?: string | null;
};

export function LetterAvatar({ id, name, size = 44, imageUrl }: Props) {
  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(id) }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: avatarColor(id),
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <AppText variant={size > 56 ? 'title' : size < 32 ? 'caption' : 'subtitle'} style={{ color: '#F4F1EA' }}>
        {avatarLetter(name)}
      </AppText>
    </View>
  );
}
