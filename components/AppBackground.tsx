import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';

export function AppBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[colors.backgroundTop, colors.background, '#070605']}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.glow, styles.redGlow]} />
      <View style={[styles.glow, styles.goldGlow]} />
      <View style={[styles.ring, styles.ringOuter]} />
      <View style={[styles.ring, styles.ringInner]} />
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    borderRadius: 999,
  },
  redGlow: {
    width: 420,
    height: 420,
    right: -190,
    top: -160,
    backgroundColor: 'rgba(201, 74, 52, 0.12)',
  },
  goldGlow: {
    width: 360,
    height: 360,
    left: -190,
    bottom: -130,
    backgroundColor: 'rgba(199, 164, 103, 0.06)',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(244, 234, 214, 0.045)',
    borderRadius: 999,
  },
  ringOuter: {
    width: 520,
    height: 520,
    right: -290,
    top: 40,
  },
  ringInner: {
    width: 390,
    height: 390,
    right: -220,
    top: 105,
  },
});
