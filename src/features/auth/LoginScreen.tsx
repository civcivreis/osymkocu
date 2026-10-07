import { zodResolver } from '@hookform/resolvers/zod';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Platform, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Screen } from '@/src/components/ui/Screen';
import { TextField } from '@/src/components/ui/TextField';
import { EMAIL_NOT_CONFIRMED, useAuthActions } from '@/src/features/auth/useAuth';
import { loginSchema, type LoginFormValues } from '@/src/features/auth/schemas';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { APP_BLURB, APP_NAME, APP_TAGLINE } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function LoginScreen() {
  const { spacing, colors } = useAppTheme();
  const { signIn } = useAuthActions();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
    } catch (error) {
      if (error instanceof Error && error.message === EMAIL_NOT_CONFIRMED) {
        router.replace({
          pathname: '/verify-email',
          params: { email: values.email.trim() },
        });
        return;
      }
      setFormError(error instanceof Error ? error.message : 'Giriş yapılamadı');
    }
  });

  return (
    <Screen scroll center>
      <SeoHead title={`Giriş | ${APP_NAME}`} path="/giris" />
      <View style={{ gap: spacing.xl, alignItems: 'stretch', width: '100%', maxWidth: 420, alignSelf: 'center' }}>
        <View style={{ gap: spacing.sm, alignItems: 'center' }}>
          <AppText variant="display" style={{ textAlign: 'center' }}>
            {APP_NAME}
          </AppText>
          <AppText tone="accent" style={{ textAlign: 'center' }}>
            {APP_TAGLINE}
          </AppText>
          <AppText tone="muted" style={{ textAlign: 'center' }}>
            {APP_BLURB}
          </AppText>
        </View>

        <View style={{ gap: spacing.lg }}>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                label="E-posta"
                keyboardType="email-address"
                autoComplete="email"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={errors.email?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                label="Şifre"
                secureTextEntry
                autoComplete="password"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={errors.password?.message}
              />
            )}
          />
          {formError ? (
            <AppText tone="danger" variant="caption" style={{ textAlign: 'center' }}>
              {formError}
            </AppText>
          ) : null}
          <Button label="Giriş yap" loading={isSubmitting} onPress={onSubmit} />
        </View>

        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <AppText tone="muted">Hesabın yok mu?</AppText>
          <Link href="/kayit" style={{ color: colors.accent, fontWeight: '600', fontSize: 16 }}>
            Kayıt ol
          </Link>
          {Platform.OS === 'web' ? (
            <Link href="/" style={{ color: colors.textMuted, fontWeight: '500', fontSize: 14 }}>
              Ana sayfaya dön
            </Link>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
