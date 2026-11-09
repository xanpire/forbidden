import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/constants/theme';
import { APP_NAME } from '@/lib/brand';

const vultureMark = require('../assets/images/vulture-mark.png');

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.row} accessibilityLabel={APP_NAME}>
      <Image source={vultureMark} style={[styles.mark, compact && styles.markCompact]} />
      <Text style={[styles.word, compact && styles.wordCompact]}>{APP_NAME}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mark: {
    width: 26,
    height: 26,
  },
  markCompact: {
    width: 22,
    height: 22,
  },
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