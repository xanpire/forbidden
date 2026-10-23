import { Tabs } from 'expo-router';
import { BookOpen, Flame, ScrollText, Settings2, Users } from 'lucide-react-native';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '@/constants/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: styles.label,
        tabBarStyle: [
          styles.tabBar,
          {
            borderTopColor: colors.accent,
            height: 58 + Math.max(insets.bottom, Platform.OS === 'web' ? 8 : 4),
            paddingBottom: Math.max(insets.bottom, 4),
          },
        ],
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Story',
          tabBarIcon: ({ color, focused }) => (
            <BookOpen color={color} size={21} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="characters"
        options={{
          title: 'Bonds',
          tabBarIcon: ({ color, focused }) => (
            <Users color={color} size={21} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="jutsu"
        options={{
          title: 'Jutsu',
          tabBarIcon: ({ color, focused }) => (
            <Flame color={color} size={21} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: 'Journal',
          tabBarIcon: ({ color, focused }) => (
            <ScrollText color={color} size={21} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Settings2 color={color} size={21} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: 2,
    borderTopColor: colors.accent,
    backgroundColor: colors.background,
    paddingTop: 8,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 0.1,
  },
});
