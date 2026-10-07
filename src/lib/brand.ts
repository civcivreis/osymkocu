export const APP_NAME = 'ÖSYM Koçu';
export const APP_TAGLINE = 'TYT • AYT • KPSS';

function publicHost(value: string | undefined, fallback: string) {
  const raw = (value ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return raw || fallback;
}

/** Canonical web host. Native scheme `kocum` is unchanged until Phase 4 deep-link migration. */
export const APP_DOMAIN = publicHost(process.env.EXPO_PUBLIC_APP_DOMAIN, 'osymkocu.com');
export const ADMIN_DOMAIN = publicHost(process.env.EXPO_PUBLIC_ADMIN_DOMAIN, 'admin.osymkocu.com');
export const APP_URL = `https://${APP_DOMAIN}`;
export const ADMIN_URL = `https://${ADMIN_DOMAIN}`;
export const APP_BLURB = 'Sınavına kadar bugün ne çalışacağını sen düşünme.';

/**
 * TODO(Phase 4): migrate native deep links from scheme `kocum://` to https://{APP_DOMAIN}
 * without breaking existing installs. Keep app.json slug/scheme `kocum` until then.
 */
export const NATIVE_DEEP_LINK_SLUG = 'kocum';
