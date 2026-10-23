import { Platform, type TextStyle } from 'react-native';

export const colors = {
  background: '#0A0908',
  backgroundTop: '#15100E',
  surface: '#12100E',
  surfaceRaised: '#1A1613',
  surfaceSoft: '#211B17',
  border: 'rgba(244, 234, 214, 0.10)',
  borderStrong: 'rgba(244, 234, 214, 0.18)',
  text: '#F4EAD6',
  textMuted: '#B9AC99',
  textDim: '#817667',
  accent: '#C94A34',
  accentBright: '#E36B4F',
  accentSoft: 'rgba(201, 74, 52, 0.15)',
  accentBorder: 'rgba(227, 107, 79, 0.34)',
  gold: '#C7A467',
  goldSoft: 'rgba(199, 164, 103, 0.12)',
  goldBorder: 'rgba(199, 164, 103, 0.28)',
  success: '#86BA98',
  successSoft: 'rgba(134, 186, 152, 0.12)',
  danger: '#E36B5D',
  dangerSoft: 'rgba(227, 107, 93, 0.12)',
  onAccent: '#FFF6E8',
  overlay: 'rgba(4, 3, 3, 0.76)',
  white: '#FFFFFF',
};

export const fonts = {
  display:
    Platform.select({
      ios: 'Georgia',
      android: 'serif',
      default: 'Georgia, "Times New Roman", serif',
    }) ?? 'serif',
  body:
    Platform.select({
      ios: 'System',
      android: 'sans-serif',
      default: 'Inter, ui-sans-serif, system-ui, sans-serif',
    }) ?? 'sans-serif',
  bodyMedium:
    Platform.select({
      ios: 'System',
      android: 'sans-serif-medium',
      default: 'Inter, ui-sans-serif, system-ui, sans-serif',
    }) ?? 'sans-serif',
  mono:
    Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    }) ?? 'monospace',
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
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 28,
  full: 999,
};

export const type: Record<
  'eyebrow' | 'display' | 'title' | 'heading' | 'body' | 'caption' | 'mono',
  TextStyle
> = {
  eyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  display: {
    fontFamily: fonts.display,
    fontSize: 54,
    lineHeight: 58,
    letterSpacing: -1.4,
    color: colors.text,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.6,
    color: colors.text,
  },
  heading: {
    fontFamily: fonts.bodyMedium,
    fontSize: 17,
    lineHeight: 23,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textMuted,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textDim,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textDim,
  },
};

export const shadows = Platform.select({
  web: {
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.35)',
  },
  default: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 10,
  },
});
