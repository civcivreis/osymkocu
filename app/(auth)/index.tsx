import { Platform } from 'react-native';

import { LoginScreen } from '@/src/features/auth/LoginScreen';
import { LandingScreen } from '@/src/features/web/LandingScreen';
import { isAdminHost } from '@/src/lib/hosts';

export default function AuthIndex() {
  if (Platform.OS === 'web' && isAdminHost()) return <LoginScreen />;
  if (Platform.OS === 'web') return <LandingScreen />;
  return <LoginScreen />;
}
