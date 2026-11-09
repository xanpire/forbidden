import { useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';

import { colors, fonts } from '@/constants/theme';
import { shownAppName, usePrivacy } from '@/lib/privacy';

/** The app's name. A double tap is the quick-hide. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  const { settings, hide } = usePrivacy();
  const lastTap = useRef(0);
  const name = shownAppName(settings);
  return (
    <Pressable
      accessibilityHint="Double tap to hide the screen"
      accessibilityLabel={name}
      onPress={() => {
        const now = Date.now();
        if (now - lastTap.current < 400) hide();
        lastTap.current = now;
      }}
      style={styles.row}
    >
      {settings.neutralName ? null : (
        <Svg accessibilityElementsHidden height={compact ? 16 : 20} viewBox="0 0 20 20" width={compact ? 16 : 20}>
          <Circle cx={10} cy={7} fill={colors.accent} r={4.5} />
          <Polygon fill={colors.accent} points="8.4,9 11.6,9 13.6,17.5 6.4,17.5" />
        </Svg>
      )}
      <Text style={[styles.word, compact && styles.wordCompact]}>{name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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