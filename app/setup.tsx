// First launch: the two keys the app needs, with the links to get them, and a
// way straight into a new story. Shown once by itself when no OpenRouter key is
// set; it can be opened again from Settings.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { ProviderKeyBlock } from '@/components/settings/AdultSettings';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { markSetupDone } from '@/lib/setup';
import { testOpenRouterKey } from '@/lib/openrouter';
import { EXPLICIT_PROVIDERS } from '@/lib/rpg/explicitImages';
import { useGame } from '@/lib/rpg/game';

function openLink(url: string) {
  void import('expo-web-browser').then((module) => module.openBrowserAsync(url));
}

export default function SetupScreen() {
  const { apiKey, setApiKey, db, updateSettings } = useGame();
  const [key, setKey] = useState(apiKey);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const provider = db?.settings.explicitProvider ?? 'wiro';

  const saveKey = async () => {
    setChecking(true);
    const result = await testOpenRouterKey(key);
    setChecking(false);
    if (result.ok) {
      await setApiKey(key);
      setMessage({ ok: true, text: 'OpenRouter key works and is saved.' });
    } else {
      setMessage({ ok: false, text: result.message });
    }
  };

  const finish = async (to: '/new-story' | '/(tabs)') => {
    await markSetupDone();
    router.replace(to);
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={type.title}>Set up</Text>
        <Text style={type.prose}>Two keys and you can start. Both stay on this device.</Text>

        <Text style={type.sectionLabel}>1 · The story (OpenRouter)</Text>
        <Text style={type.rowMeta}>OpenRouter runs the narrator and the memory. Make an account, add a little credit, create a key and paste it here.</Text>
        <AppButton compact label="Get a key" onPress={() => openLink('https://openrouter.ai/keys')} variant="secondary" />
        <TextInput
          accessibilityLabel="OpenRouter API key"
          autoCapitalize="none"
          onChangeText={(value) => {
            setKey(value);
            setMessage(null);
          }}
          placeholder="sk-or-…"
          placeholderTextColor={colors.textDim}
          secureTextEntry
          style={styles.input}
          value={key}
        />
        <AppButton disabled={!key.trim()} label="Test and save" loading={checking} onPress={() => void saveKey()} />
        {message ? <Text style={[styles.message, !message.ok && styles.failed]}>{message.ok ? '✓' : '✕'} {message.text}</Text> : null}

        <Text style={type.sectionLabel}>2 · Pictures (optional)</Text>
        <Text style={type.rowMeta}>Pictures of sex scenes go to an explicit image provider. Pick one, get a key, test it. You can skip this and add it later in Settings.</Text>
        <View style={styles.row}>
          {EXPLICIT_PROVIDERS.map((item) => (
            <AppButton
              compact
              key={item.id}
              label={item.label}
              onPress={() => void updateSettings({ explicitProvider: item.id })}
              style={styles.flex}
              variant={provider === item.id ? 'primary' : 'secondary'}
            />
          ))}
        </View>
        <Text style={type.rowMeta}>{EXPLICIT_PROVIDERS.find((item) => item.id === provider)?.note}</Text>
        <ProviderKeyBlock key={provider} provider={provider} />

        <Text style={type.sectionLabel}>3 · Your story</Text>
        <AppButton disabled={!apiKey} label="Create your first story" onPress={() => void finish('/new-story')} />
        <AppButton label={apiKey ? 'Not now' : 'Skip for now'} onPress={() => void finish('/(tabs)')} variant="ghost" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  message: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  failed: { color: colors.danger },
});
