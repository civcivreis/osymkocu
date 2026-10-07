import Head from 'expo-router/head';
import { Platform } from 'react-native';

import { APP_NAME, APP_URL } from '@/src/lib/brand';

const DEFAULT_TITLE = 'ÖSYM Koçu | TYT AYT KPSS Çalışma Platformu';
const DEFAULT_DESCRIPTION =
  'TYT, AYT ve KPSS için test, AI koç, çalışma eşleşmeleri ve sistem sınavları. Aynı hesap telefon ve web’de.';

export function SeoHead({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  path = '/',
  index = true,
}: {
  title?: string;
  description?: string;
  path?: string;
  index?: boolean;
}) {
  if (Platform.OS !== 'web') return null;
  const canonical = `${APP_URL}${path.startsWith('/') ? path : `/${path}`}`;
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={index ? 'index,follow' : 'noindex,nofollow'} />
      <link rel="canonical" href={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={APP_NAME} />
      <meta property="og:locale" content="tr_TR" />
      <meta property="og:image" content={`${APP_URL}/icon-512.png`} />
      <link rel="icon" href="/favicon.png" type="image/png" sizes="32x32" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
    </Head>
  );
}
