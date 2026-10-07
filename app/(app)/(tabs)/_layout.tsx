import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { inboxUnreadTotal, useInbox } from '@/src/features/social/useInbox';
import { TAB_BAR_BODY_HEIGHT, tabBarPad } from '@/src/features/teacher/coachLayout';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export const unstable_settings = {
  initialRouteName: 'home',
};

export default function TabLayout() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = tabBarPad(insets.bottom);
  const inbox = useInbox();
  const unread = inboxUnreadTotal(inbox.data);
  const badge = unread > 9 ? '9+' : unread > 0 ? unread : undefined;
  const web = Platform.OS === 'web';

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: web
          ? { display: 'none', height: 0, overflow: 'hidden' }
          : {
              backgroundColor: colors.tabBar,
              borderTopColor: colors.border,
              height: TAB_BAR_BODY_HEIGHT + bottomPad,
              paddingTop: 8,
              paddingBottom: bottomPad,
            },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 2,
        },
      }}
      {...(web ? { tabBar: () => null } : {})}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Ana Sayfa',
          href: '/home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="study"
        options={{
          title: 'Ders',
          href: '/study',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'book' : 'book-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="social"
        options={{
          title: 'Sosyal',
          href: '/social',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Mesajlar',
          href: '/messages',
          tabBarBadge: badge,
          tabBarBadgeStyle: {
            backgroundColor: colors.accent,
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: '800',
            minWidth: 18,
            height: 18,
            lineHeight: 16,
          },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          href: '/profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
