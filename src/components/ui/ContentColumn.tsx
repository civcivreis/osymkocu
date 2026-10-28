import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

type Props = {
  children: ReactNode;
  maxWidth?: number;
  style?: ViewStyle;
};

/** Centers a single-column stack so one card is not stuck to the left on desktop. */
export function ContentColumn({ children, maxWidth = 720, style }: Props) {
  return (
    <View style={[{ width: '100%', maxWidth, alignSelf: 'center' }, style]}>{children}</View>
  );
}
