import { Ionicons } from '@expo/vector-icons';
import { Slot, Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { inboxUnreadTotal, useInbox } from '@/src/features/social/useInbox';
import { TAB_BAR_BODY_HEIGHT, tabBarPad } from '@/src/features/teacher/coachLayout';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export default function TabLayout() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = tabBarPad(insets.bottom);
  const inbox = useInbox();
  const unread = inboxUnreadTotal(inbox.data);
  const badge = unread > 9 ? '9+' : unread > 0 ? unread : undefined;

  if (Platform.OS === 'web') {
    return <Slot />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          height: TAB_BAR_BODY_HEIGHT + bottomPad,
          paddingTop: 10,
          paddingBottom: bottomPad,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
          marginTop: 2,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
      }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Ana Sayfa',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={26} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="study"
          options={{
            title: 'Ders',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'book' : 'book-outline'} size={26} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="social"
          options={{
            title: 'Sosyal',
            tabBarLabel: 'Sosyal',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.center, { backgroundColor: focused ? colors.accent : colors.bgMuted }]}>
                <Ionicons name="people" size={24} color={focused ? colors.accentText : color} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Mesajlar',
            tabBarBadge: badge,
            tabBarBadgeStyle: {
              backgroundColor: colors.danger,
              color: '#FFFFFF',
              fontSize: 10,
              fontWeight: '800',
              minWidth: 18,
              height: 18,
              lineHeight: 16,
            },
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={26} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'person' : 'person-outline'} size={26} color={color} />
            ),
          }}
        />
      </Tabs>
  );
}

const styles = StyleSheet.create({
  center: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginTop: -14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
