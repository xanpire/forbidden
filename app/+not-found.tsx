import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/AppBackground';
import { Wordmark } from '@/components/Wordmark';
import { colors, fonts, spacing } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <View style={styles.root}>
      <AppBackground />
      <SafeAreaView style={styles.safe}>
        <Wordmark />
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>LOST ON THE ROAD</Text>
          <Text style={styles.title}>This path ends here.</Text>
          <Text style={styles.body}>
            The page you were looking for is not part of Kan’s story.
          </Text>
        </View>
        <Link href="/(tabs)" style={styles.link}>
          <Text style={styles.linkText}>Return to the story</Text>
        </Link>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safe: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.xxxl,
  },
  copy: {
    gap: spacing.sm,
  },
  eyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.gold,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 38,
    lineHeight: 44,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted,
    maxWidth: 340,
  },
  link: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: colors.accent,
  },
  linkText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.onAccent,
  },
});
