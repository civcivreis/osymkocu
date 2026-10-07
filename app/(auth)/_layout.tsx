import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="giris" />
      <Stack.Screen name="kayit" />
      <Stack.Screen name="register" />
      <Stack.Screen name="verify-email" />
    </Stack>
  );
}
