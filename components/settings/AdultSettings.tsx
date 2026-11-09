// Settings → Models test and Privacy (session A).
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ListRow } from '@/components/List';
import { useToast } from '@/components/Toast';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { completeChat } from '@/lib/openrouter';
import { usePrivacy, validPin, withPin } from '@/lib/privacy';
import type { Settings } from '@/lib/rpg/types';
import { loadProviderKey, saveProviderKey } from '@/lib/explicitProviders';
import { DEFAULT_EXPLICIT_MODELS, EXPLICIT_PROVIDERS, type ExplicitProviderId } from '@/lib/rpg/explicitImages';

/** The story calls read the story, so each needs a model whose terms allow adult content. */
export const STORY_CALLS: { key: 'narrationModel' | 'extractionModel' | 'summaryModel'; label: string }[] = [
  { key: 'narrationModel', label: 'Story' },
  { key: 'extractionModel', label: 'Memory' },
  { key: 'summaryModel', label: 'Summaries' },
];

/** Story calls routed to a provider whose terms don't allow sexual content. */
export function storyModelWarnings(settings: Pick<Settings, 'narrationModel' | 'extractionModel' | 'summaryModel'>): string[] {
  return STORY_CALLS.filter((call) => /^anthropic\//i.test(settings[call.key]?.trim() ?? '')).map((call) => call.label);
}

type Result = { label: string; model: string; ok: boolean; ms: number; note: string };

export function ModelTest({ apiKey, settings }: { apiKey: string; settings: Settings }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const warnings = storyModelWarnings(settings);

  const run = async () => {
    setRunning(true);
    const out: Result[] = [];
    for (const call of STORY_CALLS) {
      const model = settings[call.key];
      const started = Date.now();
      try {
        const reply = await completeChat({
          apiKey,
          model,
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          temperature: 0,
          maxTokens: 400,
        });
        out.push({ label: call.label, model, ok: /ok/i.test(reply.text), ms: Date.now() - started, note: reply.text.trim().slice(0, 40) });
      } catch (error) {
        out.push({ label: call.label, model, ok: false, ms: Date.now() - started, note: error instanceof Error ? error.message.slice(0, 80) : 'failed' });
      }
      setResults([...out]);
    }
    setRunning(false);
  };

  return (
    <View style={styles.block}>
      {warnings.length > 0 ? (
        <Text style={styles.warning}>
          {warnings.join(', ')} {warnings.length === 1 ? 'uses' : 'use'} a Claude model. Claude doesn't allow sexual content, so pick another model for story calls.
        </Text>
      ) : null}
      <AppButton compact disabled={!apiKey} label="Test the story models" loading={running} onPress={() => void run()} variant="secondary" />
      {results.map((result) => (
        <Text key={result.label} style={[styles.result, !result.ok && styles.failed]}>
          {result.ok ? '✓' : '✕'} {result.label} · {result.model} · {(result.ms / 1000).toFixed(1)}s{result.ok ? '' : ` · ${result.note}`}
        </Text>
      ))}
    </View>
  );
}

export function PrivacySettings() {
  const { settings, update, hide } = usePrivacy();
  const { showToast } = useToast();
  const [pin, setPin] = useState('');

  const savePin = async () => {
    if (!validPin(pin)) {
      showToast('A PIN is 4 to 8 digits.', 'error');
      return;
    }
    await update(withPin(settings, pin));
    setPin('');
    showToast('PIN set. The app locks when you leave it.', 'success');
  };

  return (
    <>
      <View style={styles.block}>
        <Text style={type.rowTitle}>{settings.pinHash ? 'PIN lock is on' : 'PIN lock'}</Text>
        <Text style={type.rowMeta}>Asks for a PIN when you open the app or come back to it. Double tap the name at the top, or press Escape, to hide the screen at once.</Text>
        <View style={styles.pinRow}>
          <TextInput
            accessibilityLabel={settings.pinHash ? 'New PIN' : 'PIN'}
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={8}
            onChangeText={(text) => setPin(text.replace(/\D/g, ''))}
            placeholder={settings.pinHash ? 'New PIN' : '4–8 digits'}
            placeholderTextColor={colors.textDim}
            secureTextEntry
            style={styles.input}
            value={pin}
          />
          <AppButton compact label={settings.pinHash ? 'Change' : 'Set'} onPress={() => void savePin()} />
        </View>
        {settings.pinHash ? (
          <View style={styles.pinRow}>
            <AppButton compact label="Lock now" onPress={hide} style={styles.flex} variant="secondary" />
            <AppButton compact label="Remove PIN" onPress={() => void update(withPin(settings, null))} style={styles.flex} variant="ghost" />
          </View>
        ) : null}
      </View>
      <ListRow
        accessibilityRole="switch"
        accessibilityState={{ checked: settings.neutralName }}
        meta={'Shows "Notes" in the browser tab and on the lock screen instead of the app\'s name.'}
        onPress={() => void update({ ...settings, neutralName: !settings.neutralName })}
        title="Neutral name"
        trailing={
          <Switch
            onValueChange={(neutralName) => void update({ ...settings, neutralName })}
            thumbColor={colors.text}
            trackColor={{ false: colors.surfaceSoft, true: colors.accent }}
            value={settings.neutralName}
            {...(Platform.OS === 'web' ? { activeThumbColor: colors.text } : {})}
          />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm, padding: spacing.lg },
  warning: { color: colors.warning, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  result: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  failed: { color: colors.danger },
  pinRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  flex: { flex: 1 },
  providerBlock: { gap: spacing.xs, marginTop: spacing.sm },
  label: { color: colors.textSoft, fontFamily: fonts.semibold, fontSize: 13 },
  compare: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },
});

export function ExplicitSettings({
  settings,
  updateSettings,
}: {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}) {
  const { showToast } = useToast();
  const provider = settings.explicitProvider ?? 'runware';
  const [keys, setKeys] = useState<Record<ExplicitProviderId, string>>({ runware: '', wiro: '' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([loadProviderKey('runware'), loadProviderKey('wiro')]).then(([runware, wiro]) => {
      setKeys({ runware, wiro });
      setLoaded(true);
    });
  }, []);

  return (
    <View style={styles.block}>
      <Text style={type.rowTitle}>Pictures</Text>
      <Text style={type.rowMeta}>Pictures are only made when you tap Picture on a reply. In a sex scene they always go to the explicit provider: only adults with a stated age, never real people, and never your uploaded photos.</Text>
      <View style={styles.pinRow}>
        <AppButton compact label="Standard image model" onPress={() => void updateSettings({ picturesOn: 'standard' })} style={styles.flex} variant={(settings.picturesOn ?? 'standard') === 'standard' ? 'primary' : 'secondary'} />
        <AppButton compact label="Explicit provider" onPress={() => void updateSettings({ picturesOn: 'explicit' })} style={styles.flex} variant={settings.picturesOn === 'explicit' ? 'primary' : 'secondary'} />
      </View>
      <Text style={type.rowMeta}>{settings.picturesOn === 'explicit' ? 'Every picture goes to the explicit provider below, for one look and one key.' : 'Other pictures use the standard image model from Models.'}</Text>
      <Text style={styles.label}>Explicit provider</Text>
      <View style={styles.pinRow}>
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
      {EXPLICIT_PROVIDERS.map((item) => (
        <View key={item.id} style={styles.providerBlock}>
          <Text style={styles.label}>{item.label} model</Text>
          <TextInput
            accessibilityLabel={`${item.label} model`}
            autoCapitalize="none"
            onChangeText={(value) => void updateSettings(item.id === 'runware' ? { runwareModel: value } : { wiroModel: value })}
            placeholder={DEFAULT_EXPLICIT_MODELS[item.id]}
            placeholderTextColor={colors.textDim}
            style={styles.input}
            value={(item.id === 'runware' ? settings.runwareModel : settings.wiroModel) ?? ''}
          />
          <Text style={styles.label}>{item.label} API key</Text>
          <View style={styles.pinRow}>
            <TextInput
              accessibilityLabel={`${item.label} API key`}
              autoCapitalize="none"
              editable={loaded}
              onChangeText={(value) => setKeys((current) => ({ ...current, [item.id]: value }))}
              placeholder="Stays on this device"
              placeholderTextColor={colors.textDim}
              secureTextEntry
              style={styles.input}
              value={keys[item.id]}
            />
            <AppButton
              compact
              label="Save"
              onPress={() => void saveProviderKey(item.id, keys[item.id]).then(() => showToast(`${item.label} key saved.`, 'success'))}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
