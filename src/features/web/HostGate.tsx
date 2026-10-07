import { Redirect, usePathname } from 'expo-router';
import { type ReactNode, useEffect } from 'react';
import { Platform } from 'react-native';

import { isEmailVerified } from '@/src/lib/auth/emailVerification';
import { adminPanelUrl, isAdminHost, isLocalWebHost, shouldBlockAdminOnAppHost } from '@/src/lib/hosts';
import { useAuthStore } from '@/src/stores/authStore';

export function HostGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const onboarded = Boolean(profile?.onboarding_completed_at);
  const path = pathname || '/';

  useEffect(() => {
    if (!initialized) return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (shouldBlockAdminOnAppHost() && path.startsWith('/admin')) {
      window.location.href = adminPanelUrl(path + window.location.search);
    }
  }, [initialized, path]);

  if (Platform.OS !== 'web' || !initialized) {
    return <>{children}</>;
  }

  if (shouldBlockAdminOnAppHost() && path.startsWith('/admin')) {
    return null;
  }

  if (
    isAdminHost() &&
    !isLocalWebHost() &&
    session &&
    isEmailVerified(session) &&
    onboarded &&
    !path.startsWith('/admin')
  ) {
    return <Redirect href={'/admin' as never} />;
  }

  return <>{children}</>;
}
