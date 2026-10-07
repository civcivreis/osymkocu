import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Screen } from '@/src/components/ui/Screen';
import { TextField } from '@/src/components/ui/TextField';
import { registerSchema, type RegisterFormValues } from '@/src/features/auth/schemas';
import { useAuthActions } from '@/src/features/auth/useAuth';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { APP_NAME } from '@/src/lib/brand';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function RegisterScreen() {
  const { spacing, colors } = useAppTheme();
  const { signUp } = useAuthActions();
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setInfo(null);
    try {
      const result = await signUp({
        email: values.email,
        password: values.password,
        displayName: values.displayName,
      });
      if (result.needsEmailConfirmation) {
        setInfo('Mailine bir onay gitti. Linke bas, sonra giriş yap.');
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Kayıt tamamlanamadı');
    }
  });

  return (
    <Screen scroll center>
      <SeoHead title={`Kayıt | ${APP_NAME}`} path="/kayit" />
      <View style={{ gap: spacing.xl, width: '100%', maxWidth: 420, alignSelf: 'center' }}>
        <View style={{ gap: spacing.sm, alignItems: 'center' }}>
          <AppText variant="display" style={{ textAlign: 'center' }}>
            Hesap oluştur
          </AppText>
          <AppText tone="muted" style={{ textAlign: 'center' }}>
            {APP_NAME} ile aynı hesabın telefon ve web’de çalışır.
          </AppText>
        </View>

        <View style={{ gap: spacing.lg }}>
          <Controller
            control={control}
            name="displayName"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                label="Adın"
                autoCapitalize="words"
                autoComplete="name"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={errors.displayName?.message}
              />
            )}
          />
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
                autoComplete="new-password"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={errors.password?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                label="Şifre tekrar"
                secureTextEntry
                autoComplete="new-password"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={errors.confirmPassword?.message}
              />
            )}
          />
          {formError ? (
            <AppText tone="danger" variant="caption" style={{ textAlign: 'center' }}>
              {formError}
            </AppText>
          ) : null}
          {info ? (
            <AppText tone="accent" variant="caption" style={{ textAlign: 'center' }}>
              {info}
            </AppText>
          ) : null}
          <Button label="Kayıt ol" loading={isSubmitting} onPress={onSubmit} />
        </View>

        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <Link href="/giris" style={{ color: colors.accent, fontWeight: '600', fontSize: 16 }}>
            Giriş ekranına dön
          </Link>
        </View>
      </View>
    </Screen>
  );
}
