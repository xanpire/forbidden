import { CircleAlert, CircleCheck, Info } from 'lucide-react-native';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { colors, fonts, radius } from '@/constants/theme';

type ToastTone = 'success' | 'error' | 'info';

type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const useNativeDriver = Platform.OS !== 'web';

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    if (timer.current) {
      clearTimeout(timer.current);
    }

    opacity.setValue(0);
    translateY.setValue(10);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 160,
        useNativeDriver,
      }),
    ]).start();

    timer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver,
        }),
        Animated.timing(translateY, {
          toValue: 6,
          duration: 180,
          useNativeDriver,
        }),
      ]).start(() => setToast(null));
    }, 2800);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [opacity, toast, translateY]);

  const value = useMemo(() => ({ showToast }), [showToast]);
  const ToneIcon =
    toast?.tone === 'success'
      ? CircleCheck
      : toast?.tone === 'error'
        ? CircleAlert
        : Info;
  const toneColor =
    toast?.tone === 'success'
      ? colors.success
      : toast?.tone === 'error'
        ? colors.danger
        : colors.gold;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastDock,
            {
              bottom: insets.bottom + 86,
              opacity,
              transform: [{ translateY }],
            },
          ]}
        >
          <View accessibilityLiveRegion="polite" style={styles.toast}>
            <ToneIcon color={toneColor} size={18} strokeWidth={1.8} />
            <Text style={styles.message}>{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider');
  }

  return context;
}

const styles = StyleSheet.create({
  toastDock: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    maxWidth: 520,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 12,
  },
  message: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
  },
});
