import { Redirect } from 'expo-router';

export function AdminContentFactoryScreen() {
  return <Redirect href={'/admin/mufredat' as never} />;
}
