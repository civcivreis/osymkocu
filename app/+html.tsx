import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

import { APP_NAME, APP_URL } from '@/src/lib/brand';

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>ÖSYM Koçu | TYT AYT KPSS Çalışma Platformu</title>
        <meta
          name="description"
          content="TYT, AYT ve KPSS için test, AI koç, çalışma eşleşmeleri ve sistem sınavları. Aynı hesap telefon ve web’de."
        />
        <link rel="canonical" href={APP_URL} />
        <link rel="icon" href="/favicon.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#C45C26" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />
        <meta property="og:title" content="ÖSYM Koçu | TYT AYT KPSS Çalışma Platformu" />
        <meta property="og:description" content="TYT, AYT ve KPSS çalışma platformu. Telefon ve web’de aynı hesap." />
        <meta property="og:url" content={APP_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="tr_TR" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
@font-face {
  font-family: ionicons;
  src: url('/fonts/Ionicons.ttf') format('truetype');
  font-display: block;
}
body {
  background-color: #F4F1EA;
}`;
