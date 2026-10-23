import { StyleSheet, Text } from 'react-native';

import { colors, fonts } from '@/constants/theme';

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Text
      accessibilityLabel="Kan"
      style={[styles.word, compact && styles.wordCompact]}
    >
      KAN
    </Text>
  );
}

const styles = StyleSheet.create({
  word: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: 1.6,
    color: colors.accent,
  },
  wordCompact: {
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: 1.2,
  },
});
