import { useCallback, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { C, R, SP, T, TYPE, shadow } from '../theme';

/**
 * A press that lands.
 *
 * Every tappable surface in the app sinks very slightly under the thumb and comes back. It is a
 * few pixels of scale, but on a mid-range Android at the end of a queue it is the difference
 * between a tool that feels answerable and one the operator taps twice because they were not
 * sure the first one took.
 *
 * Driven natively, so it keeps running even while JavaScript is busy saving the bill.
 */
function usePressScale(to = 0.97) {
  const scale = useRef(new Animated.Value(1)).current;
  const run = useCallback(
    (value: number, duration: number) => {
      Animated.timing(scale, {
        toValue: value,
        duration,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    },
    [scale],
  );
  return {
    scale,
    onPressIn: () => run(to, T.tap),
    onPressOut: () => run(1, T.base),
  };
}

/** A surface that responds to touch. Used for cards, rows and anything else tappable. */
export function Touchable({
  children, onPress, disabled, style, scaleTo,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
  scaleTo?: number;
}) {
  const press = usePressScale(scaleTo);
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function Button({
  label, onPress, tone = 'primary', disabled, style, busy,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'plain' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
  busy?: boolean;
}) {
  const press = usePressScale(0.975);
  const plain = tone === 'plain';
  const bg = tone === 'primary' ? C.accent : tone === 'danger' ? C.danger : C.card;
  const fg = plain ? C.ink : C.accentInk;

  return (
    <Animated.View style={[{ transform: [{ scale: press.scale }] }, style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[
          styles.btn,
          plain ? styles.btnPlain : shadow(1),
          { backgroundColor: bg, opacity: disabled ? 0.42 : 1 },
        ]}
      >
        <Text style={[styles.btnLabel, { color: fg }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function Field({ label, hint, ...props }: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        style={[styles.input, props.style]}
        placeholderTextColor={C.faint}
        selectionColor={C.accentBright}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, shadow(1), style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Fade>
      <Text style={styles.error}>{children}</Text>
    </Fade>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <Fade>
      <Text style={styles.notice}>{children}</Text>
    </Fade>
  );
}

/**
 * Anything that appears mid-screen -- a saved confirmation, an error -- rises into place rather
 * than blinking on, so the eye is led to it instead of startled by it.
 */
export function Fade({ children, offset = 8 }: { children: ReactNode; offset?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    Animated.timing(t, {
      toValue: 1,
      duration: T.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }
  return (
    <Animated.View
      style={{
        opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** What a screen shows when there is nothing on it yet -- drawn, not left as a grey sentence. */
export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Fade>
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>{icon}</View>
        <Text style={styles.emptyText}>{children}</Text>
      </View>
    </Fade>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 50,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: R.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPlain: { borderWidth: 1, borderColor: C.lineStrong },
  btnLabel: { fontSize: 16, fontWeight: '700' },

  field: { marginBottom: SP.md },
  fieldLabel: { ...TYPE.label, marginBottom: 5 },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: R.sm,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 17,
    color: C.ink,
    minHeight: 50,
  },
  hint: { ...TYPE.hint, marginTop: 5 },

  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
    padding: SP.lg,
  },
  section: { ...TYPE.section, marginBottom: 10 },

  error: {
    backgroundColor: C.dangerWash,
    borderWidth: 1,
    borderColor: C.dangerEdge,
    color: C.danger,
    fontWeight: '600',
    borderRadius: R.sm,
    padding: 11,
    fontSize: 14,
    marginBottom: 10,
    lineHeight: 19,
  },
  notice: {
    backgroundColor: C.accentWash,
    borderWidth: 1,
    borderColor: C.accentEdge,
    color: C.accentDeep,
    borderRadius: R.sm,
    padding: 11,
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 19,
  },

  empty: {
    alignItems: 'center',
    gap: SP.md,
    paddingVertical: 40,
    paddingHorizontal: 20,
    marginVertical: SP.xs,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderStyle: 'dashed',
    borderRadius: R.lg,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: R.pill,
    backgroundColor: C.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { fontSize: 14, lineHeight: 21, color: C.soft, textAlign: 'center', maxWidth: 260 },
});
