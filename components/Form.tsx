// Small form kit for the creation wizard and the world editor: labelled text
// fields, number fields, toggles, pill choices and removable item cards. Built
// on the theme tokens so it matches the list kit.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';

import { colors, fonts, radius, spacing, type } from '@/constants/theme';

export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  multiline = false,
  lines = 4,
  required = false,
  secure = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  lines?: number;
  required?: boolean;
  secure?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        numberOfLines={multiline ? lines : 1}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        secureTextEntry={secure}
        style={[styles.input, multiline && { minHeight: 22 * lines + 20, textAlignVertical: 'top' }]}
        value={value}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  allowEmpty = false,
  required = false,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  hint?: string;
  allowEmpty?: boolean;
  required?: boolean;
}) {
  const shown = value === undefined || value === null ? '' : String(value);
  // Keeps its own text so "0." or "-" survive while typing.
  const [text, setText] = useState(shown);
  useEffect(() => {
    if (Number(text) !== value && !(text === '' && value === undefined)) setText(shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View style={[styles.field, styles.numberField]}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={label}
        inputMode="decimal"
        keyboardType="numeric"
        onChangeText={(raw) => {
          const next = raw.replace(/[^0-9.-]/g, '');
          setText(next);
          if (!next) return onChange(allowEmpty ? undefined : 0);
          const parsed = Number(next);
          if (Number.isFinite(parsed) && !/[.-]$/.test(next)) onChange(parsed);
        }}
        placeholderTextColor={colors.textDim}
        style={styles.input}
        value={text}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * A list edited as text: one item per line (or comma-separated). Keeps its own
 * text so typing a new line or a trailing comma isn't eaten mid-edit.
 */
export function ListField({
  label,
  values,
  onChange,
  placeholder,
  hint,
  separator = 'lines',
  lines = 3,
}: {
  label: string;
  values: string[] | undefined;
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
  separator?: 'lines' | 'commas';
  lines?: number;
}) {
  const join = (list: string[] | undefined) => (list ?? []).join(separator === 'lines' ? '\n' : ', ');
  const split = (text: string) =>
    text
      .split(separator === 'lines' ? '\n' : ',')
      .map((item) => item.trim())
      .filter(Boolean);
  const [text, setText] = useState(join(values));
  const last = useRef(join(values));

  useEffect(() => {
    const incoming = join(values);
    // Only take outside changes (an accepted suggestion), not our own echo.
    if (incoming !== join(split(last.current))) {
      setText(incoming);
      last.current = incoming;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  return (
    <Field
      hint={hint ?? (separator === 'lines' ? 'One per line.' : 'Separate with commas.')}
      label={label}
      lines={lines}
      multiline={separator === 'lines'}
      onChange={(next) => {
        setText(next);
        last.current = next;
        onChange(split(next));
      }}
      placeholder={placeholder}
      value={text}
    />
  );
}

export function MultiChoice({
  label,
  options,
  values,
  onChange,
  hint,
}: {
  label?: string;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (values: string[]) => void;
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {options.length === 0 ? <Text style={styles.hint}>Nothing to pick yet.</Text> : null}
      <View style={styles.pills}>
        {options.map((option) => {
          const selected = values.includes(option.value);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              key={option.value}
              onPress={() => onChange(selected ? values.filter((value) => value !== option.value) : [...values, option.value])}
              style={[styles.pill, selected && styles.pillSelected]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        onValueChange={onChange}
        thumbColor={colors.white}
        trackColor={{ false: colors.surfaceSoft, true: colors.accent }}
        value={value}
        {...(Platform.OS === 'web' ? { activeThumbColor: colors.white } : {})}
      />
    </View>
  );
}

export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.pills}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.pill, selected && styles.pillSelected]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function ItemCard({ title, onRemove, children }: { title: string; onRemove?: () => void; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text numberOfLines={1} style={[type.rowTitle, styles.flex]}>
          {title}
        </Text>
        {onRemove ? (
          <Pressable accessibilityLabel={`Remove ${title}`} accessibilityRole="button" hitSlop={10} onPress={onRemove}>
            <Trash2 color={colors.textDim} size={17} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
      <Text style={styles.addText}>+ {label}</Text>
    </Pressable>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={[styles.hint, styles.hintBlock]}>{children}</Text>;
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing.lg, flexGrow: 1 },
  numberField: { minWidth: 72, flexBasis: 72 },
  row: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textSoft, marginBottom: spacing.xs },
  required: { color: colors.accentText },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.textDim, marginTop: spacing.xs },
  hintBlock: { marginBottom: spacing.lg, marginTop: 0 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  toggleLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.textSoft },
  flex: { flex: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  pillSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  pillText: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted },
  pillTextSelected: { color: colors.accentText },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
    paddingBottom: 0,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  add: {
    alignItems: 'center',
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginBottom: spacing.lg,
    paddingVertical: spacing.md,
  },
  addText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accentText },
  pressed: { opacity: 0.7 },
});
