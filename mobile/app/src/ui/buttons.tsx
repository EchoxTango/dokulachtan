// Sdílené akce appky (docs/17-ui-hierarchie-akci.md): čtyři váhy tlačítek.
// Primární = jediná dopředná akce stavu, sekundární = alternativa téhož úkolu,
// textová = navigace / zrušení / testovací cesta, destruktivní = nevratná akce.
// Váhu určuje význam akce, ne pořadí, ve kterém se funkce přidala.
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

const ACCENT = '#291334';
const DANGER = '#991b1b';

export interface ActionProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

interface ActionStyle {
  buttonStyle: StyleProp<ViewStyle>;
  labelStyle: StyleProp<TextStyle>;
}

function Action({
  title,
  onPress,
  disabled = false,
  loading = false,
  style,
  buttonStyle,
  labelStyle,
}: ActionProps & ActionStyle) {
  const inactive = disabled || loading;

  return (
    <TouchableOpacity
      style={[buttonStyle, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
    >
      {loading ? (
        <>
          <ActivityIndicator color={StyleSheet.flatten(labelStyle)?.color ?? '#fff'} />
          <Text style={labelStyle}>{title}</Text>
        </>
      ) : (
        <Text style={labelStyle}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function PrimaryButton(props: ActionProps) {
  return <Action {...props} buttonStyle={styles.primary} labelStyle={styles.primaryLabel} />;
}

export function SecondaryButton(props: ActionProps) {
  return <Action {...props} buttonStyle={styles.secondary} labelStyle={styles.secondaryLabel} />;
}

export function TextButton(props: ActionProps) {
  return <Action {...props} buttonStyle={styles.text} labelStyle={styles.textLabel} />;
}

export function DangerButton(props: ActionProps) {
  return <Action {...props} buttonStyle={styles.danger} labelStyle={styles.dangerLabel} />;
}

const styles = StyleSheet.create({
  primary: { backgroundColor: ACCENT, borderRadius: 24, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  secondary: { borderColor: ACCENT, borderWidth: 1, borderRadius: 24, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  secondaryLabel: { color: ACCENT, fontWeight: '600' },
  text: { paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  textLabel: { color: ACCENT, fontWeight: '600' },
  danger: { borderColor: DANGER, borderWidth: 1, borderRadius: 24, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dangerLabel: { color: DANGER, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
