import type { TextStyle } from 'react-native';

export const colors = {
  background: '#050505',
  backgroundTop: '#120507',
  surface: '#0F0F0F',
  surfaceRaised: '#181818',
  surfaceSoft: '#222222',
  border: '#232323',
  borderStrong: '#343434',
  text: '#F5F5F5',
  textMuted: '#A3A3A3',
  textDim: '#7D7D7D',
  accent: '#E50914',
  accentBright: '#FF1F2D',
  accentSoft: 'rgba(229, 9, 20, 0.12)',
  accentBorder: 'rgba(229, 9, 20, 0.42)',
  success: '#46D369',
  successSoft: 'rgba(70, 211, 105, 0.10)',
  danger: '#FF5A5F',
  dangerSoft: 'rgba(229, 9, 20, 0.10)',
  onAccent: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.82)',
  white: '#FFFFFF',
};

export const fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extrabold: 'Manrope_800ExtraBold',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
};

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  full: 999,
};

export const type: Record<
  'eyebrow' | 'display' | 'title' | 'heading' | 'body' | 'caption',
  TextStyle
> = {
  eyebrow: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  display: {
    fontFamily: fonts.extrabold,
    fontSize: 58,
    lineHeight: 62,
    letterSpacing: -2,
    color: colors.text,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.8,
    color: colors.text,
  },
  heading: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textMuted,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textDim,
  },
};
