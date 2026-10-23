import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/constants/theme';

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={[styles.seal, compact && styles.sealCompact]}>
        <Text style={[styles.sealLetter, compact && styles.sealLetterCompact]}>K</Text>
      </View>
      <Text style={[styles.word, compact && styles.wordCompact]}>KAN</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seal: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  sealCompact: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  sealLetter: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 23,
    color: colors.onAccent,
  },
  sealLetterCompact: {
    fontSize: 15,
    lineHeight: 19,
  },
  word: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: 4.5,
    color: colors.text,
  },
  wordCompact: {
    fontSize: 13,
    letterSpacing: 3.5,
  },
});
