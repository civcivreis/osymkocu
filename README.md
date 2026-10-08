# Koçum

TYT, AYT ve KPSS için AI sınav koçu. Phase 1: Expo, tema, Supabase auth.

## Çalıştır

```bash
npm install
cp .env.example .env
npx expo start
```

`.env` içine kendi Supabase URL ve anon key değerlerini yaz. AI anahtarını buraya koyma.

## Supabase

1. Yeni proje aç.
2. Authentication > Providers > Email açık olsun.
3. SQL Editor’da dosya **içeriklerini** (yolu değil) sırayla çalıştır: `0001_init.sql`, `0002_onboarding.sql`, `0003_practice.sql`, `0004_plan_sync.sql`, `0005_social.sql`, `0006_exam_sessions_auto.sql`, `0007_study_together.sql`, `0008_auto_match.sql`.
4. Authentication > URL Configuration:
   - Site URL: `https://osymkocu.com`
   - Redirect URLs:
     - `https://osymkocu.com/auth/callback`
     - `https://osymkocu.com/**`
     - `kocum://auth/callback`
     - `kocum://**`
   - Do not use `localhost` as Site URL in production.
5. Authentication > Email Templates > Confirm signup: `supabase/templates/confirm-signup.html` gövdesini yapıştır (konu: `Koçum — e-postanı onayla`).

AI Öğretmen ve onay sayfası:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase functions deploy ai
supabase functions deploy email-confirmed
```

Anahtarı `.env` veya uygulamaya koyma. Günlük plan, soru çözülünce sunucuda otomatik dolar. Koç sohbet geçmişi için `ai` fonksiyonunu her değişiklikten sonra tekrar deploy et.

## Fazlar

1. Foundation + Auth (tamam)
2. Onboarding (tamam — Supabase bağlandıktan sonra aktif)
3. Dashboard / plan / streak (tamam — plan soru çözünce otomatik dolar)
4. Soru + yanlış defteri (tamam)
5. AI Koç (yüzen widget + sohbet; OpenAI anahtarı ve deploy gerekir)
6. Deneme takibi
7. Sosyal + birlikte çalışma odası
8. Premium
9. Bildirim (push) ve polish
