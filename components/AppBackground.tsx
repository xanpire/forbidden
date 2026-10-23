import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { colors } from '@/constants/theme';

export function AppBackground() {
  return (
    <LinearGradient
      colors={[colors.backgroundTop, colors.background, colors.background]}
      locations={[0, 0.28, 1]}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    />
  );
}
