import { Redirect } from 'expo-router';

export default function Page() {
  return <Redirect href={'/admin/mufredat' as never} />;
}
