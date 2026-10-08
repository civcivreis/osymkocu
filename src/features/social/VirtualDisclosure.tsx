import { AppText } from '@/src/components/ui/AppText';

export function isVirtualProfile(profile?: { profile_type?: string | null; is_bot?: boolean | null } | null) {
  if (!profile) return false;
  return profile.profile_type === 'virtual' || profile.profile_type === 'system' || Boolean(profile.is_bot);
}

export function VirtualDisclosure({
  profile,
  compact,
}: {
  profile?: { profile_type?: string | null; is_bot?: boolean | null } | null;
  compact?: boolean;
}) {
  if (!isVirtualProfile(profile)) return null;
  return (
    <AppText variant="caption" tone="muted" style={{ textAlign: compact ? 'left' : 'center', opacity: 0.85 }}>
      {compact ? 'Sanal çalışma profili' : 'Sanal çalışma profili · ÖSYM Koçu tarafından çalışma ortamını desteklemek için kullanılır.'}
    </AppText>
  );
}
