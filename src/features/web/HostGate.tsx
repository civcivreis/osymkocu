import { Redirect, usePathname } from 'expo-router';
import { type ReactNode, useEffect } from 'react';
import { Platform } from 'react-native';

import { adminPanelUrl, isAdminHost, isLocalWebHost, shouldBlockAdminOnAppHost } from '@/src/lib/hosts';
import { useAuthStore } from '@/src/stores/authStore';

export function HostGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const onboarded = Boolean(profile?.onboarding_completed_at);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (shouldBlockAdminOnAppHost() && pathname.startsWith('/admin')) {
      window.location.href = adminPanelUrl(pathname + window.location.search);
    }
  }, [pathname]);

  if (Platform.OS === 'web' && shouldBlockAdminOnAppHost() && pathname.startsWith('/admin')) {
    return null;
  }

  if (
    Platform.OS === 'web' &&
    isAdminHost() &&
    !isLocalWebHost() &&
    session &&
    onboarded &&
    !pathname.startsWith('/admin')
  ) {
    return <Redirect href={'/admin' as never} />;
  }

  return <>{children}</>;
}
