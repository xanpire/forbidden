import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/Toast';
import { colors } from '@/constants/theme';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { SettingsProvider } from '@/lib/settings';

export default function RootLayout() {
  useFrameworkReady();

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ToastProvider>
          <View style={styles.root}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                animation: 'fade',
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="story"
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen name="+not-found" />
            </Stack>
            <StatusBar backgroundColor={colors.background} style="light" />
          </View>
        </ToastProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
