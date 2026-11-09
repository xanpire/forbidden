// Wraps the app: the PIN lock on open and whenever the app is hidden, and the
// quick-hide cover (Escape on the web, or a double tap on the wordmark).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import { notificationText } from '@/lib/rpg/intimacy';
import {
  DEFAULT_PRIVACY,
  PrivacyContext,
  checkPin,
  loadPrivacy,
  savePrivacy,
  setTabTitle,
  shownAppName,
  type PrivacySettings,
} from '@/lib/privacy';

export function PrivacyGate({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [locked, setLocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const settingsRef = useRef<PrivacySettings>(DEFAULT_PRIVACY);

  useEffect(() => {
    void loadPrivacy().then((loaded) => {
      settingsRef.current = loaded;
      setSettings(loaded);
      setLocked(Boolean(loaded.pinHash));
      setTabTitle(shownAppName(loaded));
    });
  }, []);

  const hide = useCallback(() => {
    if (settingsRef.current.pinHash) {
      setLocked(true);
    } else {
      setCovered(true);
    }
    setPin('');
  }, []);

  // Lock whenever the app goes to the background or the tab is hidden; a
  // hidden tab's title never shows story text.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && settingsRef.current.pinHash) setLocked(true);
    });
    if (Platform.OS !== 'web' || typeof document === 'undefined') return () => sub.remove();

    const onVisibility = () => {
      if (document.hidden && settingsRef.current.pinHash) setLocked(true);
      if (!document.hidden) setTabTitle(shownAppName(settingsRef.current));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKey);
    return () => {
      sub.remove();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
    };
  }, [hide]);

  const update = useCallback(async (next: PrivacySettings) => {
    settingsRef.current = next;
    setSettings(next);
    setTabTitle(shownAppName(next));
    await savePrivacy(next);
  }, []);

  const value = useMemo(() => ({ settings: settings ?? DEFAULT_PRIVACY, update, hide }), [settings, update, hide]);

  if (!settings) {
    return <View style={styles.cover} />;
  }

  const tryPin = (next: string) => {
    setPin(next);
    setWrong(false);
    if (next.length >= 4 && checkPin(settings, next)) {
      setLocked(false);
      setCovered(false);
      setPin('');
    } else if (next.length >= 8) {
      setWrong(true);
      setPin('');
    }
  };

  return (
    <PrivacyContext.Provider value={value}>
      {children}
      {locked ? (
        <View style={[StyleSheet.absoluteFill, styles.cover]}>
          <Text style={styles.title}>{shownAppName(settings)}</Text>
          <TextInput
            accessibilityLabel="PIN"
            autoFocus
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={8}
            onChangeText={(text) => tryPin(text.replace(/\D/g, ''))}
            placeholder="PIN"
            placeholderTextColor={colors.textDim}
            secureTextEntry
            style={styles.pin}
            value={pin}
          />
          {wrong ? <Text style={styles.wrong}>Wrong PIN</Text> : null}
        </View>
      ) : covered ? (
        <Pressable accessibilityLabel="Show the app again" onPress={() => setCovered(false)} style={[StyleSheet.absoluteFill, styles.cover]}>
          <Text style={styles.title}>{shownAppName(settings)}</Text>
          <Text style={styles.hint}>{notificationText('generic')}</Text>
        </Pressable>
      ) : null}
    </PrivacyContext.Provider>
  );
}

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.xxl,
    zIndex: 1000,
  },
  title: { color: colors.textSoft, fontFamily: fonts.bold, fontSize: 22 },
  hint: { color: colors.textDim, fontFamily: fonts.regular, fontSize: 13 },
  pin: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 22,
    letterSpacing: 8,
    paddingVertical: spacing.md,
    textAlign: 'center',
    width: 200,
  },
  wrong: { color: colors.danger, fontFamily: fonts.medium, fontSize: 13 },
});
