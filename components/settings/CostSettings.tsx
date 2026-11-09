// Settings → Costs: pictures made and money spent, per provider, for this
// session and this month. Estimates are marked as estimates.
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing, type } from '@/constants/theme';
import { costLineText, useCosts, type CostProvider } from '@/lib/costs';

const LABEL: Record<CostProvider, string> = { openrouter: 'OpenRouter', runware: 'Runware', wiro: 'Wiro' };

export function CostSettings() {
  const { session, month, monthLabel } = useCosts();
  return (
    <View style={styles.block}>
      <Text style={type.rowTitle}>Costs</Text>
      <Text style={type.rowMeta}>What the story and pictures have cost, from each provider's own prices. Where a provider gives none, pictures show an estimate.</Text>
      {(['session', 'month'] as const).map((period) => (
        <View key={period} style={styles.period}>
          <Text style={styles.label}>{period === 'session' ? 'This session' : `This month (${monthLabel})`}</Text>
          {(Object.keys(LABEL) as CostProvider[]).map((provider) => (
            <Text key={provider} style={styles.line}>
              <Text style={styles.provider}>{LABEL[provider]}</Text> · {costLineText((period === 'session' ? session : month)[provider])}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm, padding: spacing.lg },
  period: { gap: 2 },
  label: { color: colors.textSoft, fontFamily: fonts.semibold, fontSize: 13 },
  line: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  provider: { color: colors.text, fontFamily: fonts.semibold },
});
