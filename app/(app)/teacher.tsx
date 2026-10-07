import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useCoachStore } from '@/src/features/teacher/coachStore';

export default function TeacherRoute() {
  useEffect(() => {
    useCoachStore.getState().setOpen(true);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  return <View />;
}
