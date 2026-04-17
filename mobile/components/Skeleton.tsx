import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle } from 'react-native';

// Lightweight shimmer skeleton. Opacity pulses between 0.4 and 1.0 so the
// placeholder is obviously "loading" without shipping a gradient lib.
// Used on list screens where ActivityIndicator gave zero sense of the
// layout that's about to appear.

export function SkeletonBlock({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[styles.block, { opacity }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

export function TaskRowSkeleton() {
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel="Loading tasks">
      <SkeletonBlock style={styles.circle} />
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonBlock style={{ height: 14, width: '72%', borderRadius: 4 }} />
        <SkeletonBlock style={{ height: 10, width: '48%', borderRadius: 4 }} />
      </View>
    </View>
  );
}

export function CardSkeleton() {
  return (
    <View style={styles.card} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <SkeletonBlock style={{ width: 8, height: 40, borderRadius: 4 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonBlock style={{ height: 14, width: '60%', borderRadius: 4 }} />
        <SkeletonBlock style={{ height: 10, width: '80%', borderRadius: 4 }} />
      </View>
    </View>
  );
}

export function SkeletonList({
  count = 6,
  variant = 'task',
}: { count?: number; variant?: 'task' | 'card' }) {
  const Item = variant === 'card' ? CardSkeleton : TaskRowSkeleton;
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => <Item key={i} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: '#e3e7ee', borderRadius: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  circle: { width: 22, height: 22, borderRadius: 11 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
  },
});
