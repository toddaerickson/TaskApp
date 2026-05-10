/**
 * Draggable + DragHandle — composable drag-source primitive.
 *
 * The gesture is owned by a small <DragHandle /> rendered inside the
 * row, NOT by the row itself. Touches anywhere outside the handle
 * fall through to the parent ScrollView, so the user can scroll the
 * list without accidentally lifting a row.
 *
 * Usage:
 *
 *   <Draggable<Task> data={task} onDrop={handleDrop}>
 *     <View style={cardRow}>
 *       <DragHandle accessibilityLabel={`Reorder ${task.title}`} />
 *       <Pressable>...row content...</Pressable>
 *     </View>
 *   </Draggable>
 *
 * Behavior is the same as the prior whole-row implementation —
 * 350ms long-press to ARM + 8pt minimum travel, lift animation on
 * the wrapper, drop resolution via DragProvider.resolveTargetAt —
 * just scoped to the handle's bounds for activation.
 *
 * Why context + slot instead of a `renderHandle` prop: the row's
 * layout is the integrator's concern. With context, the integrator
 * places the handle wherever it fits their design (left edge, right
 * edge, between columns, etc.) without Draggable having to inject
 * View structure that fights with their flex layout.
 *
 * NOT in scope (deferred):
 *  - Edge-of-scroller auto-scroll.
 *  - Multi-select drag.
 *  - "Drag preview" — a custom render that shows during the drag,
 *    distinct from the in-place row.
 */
import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { GestureDetector, Gesture, type ComposedGesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useDrag } from '@/lib/dragContext';

const LONG_PRESS_MS = 350;
const DRAG_ACTIVATION_DISTANCE = 8;
const LIFT_SCALE = 1.04;

type DraggableContextValue = {
  gesture: ComposedGesture;
  /** The integrator can read this to tweak handle styling on drag,
   *  but the lift animation already lives on the wrapper. */
  disabled: boolean;
};

const DraggableContext = createContext<DraggableContextValue | null>(null);

type DraggableProps<T> = {
  /** Opaque payload returned to onDrop. */
  data: T;
  /** Called when the user releases over a registered DropTarget.
   *  `targetId === null` means released outside any target. Always
   *  called on gesture-end, even on cancel. */
  onDrop: (data: T, targetId: string | null) => void;
  /** Optional. Fired the moment the long-press ARMs the drag,
   *  before any movement. Useful for haptic feedback. */
  onDragStart?: () => void;
  /** Disable the gesture. The row still renders. */
  disabled?: boolean;
  style?: ViewStyle;
  children: ReactNode;
};

export function Draggable<T>({
  data, onDrop, onDragStart, disabled = false, style, children,
}: DraggableProps<T>) {
  const { setPointer, resolveTargetAt } = useDrag();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);

  const dataRef = useRef(data);
  dataRef.current = data;

  const handleStart = useCallback(() => {
    onDragStart?.();
  }, [onDragStart]);

  const handleMove = useCallback((x: number, y: number) => {
    setPointer({ x, y });
  }, [setPointer]);

  const handleEnd = useCallback((x: number, y: number) => {
    setPointer(null);
    const targetId = resolveTargetAt({ x, y });
    onDrop(dataRef.current, targetId);
  }, [setPointer, resolveTargetAt, onDrop]);

  const longPress = Gesture.LongPress()
    .minDuration(LONG_PRESS_MS)
    .enabled(!disabled)
    .onStart(() => {
      'worklet';
      lifted.value = withTiming(1, { duration: 120 });
      runOnJS(handleStart)();
    });

  const pan = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .minDistance(DRAG_ACTIVATION_DISTANCE)
    .enabled(!disabled)
    .onUpdate((e) => {
      'worklet';
      tx.value = e.translationX;
      ty.value = e.translationY;
      runOnJS(handleMove)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      'worklet';
      runOnJS(handleEnd)(e.absoluteX, e.absoluteY);
      tx.value = withTiming(0, { duration: 180 });
      ty.value = withTiming(0, { duration: 180 });
      lifted.value = withTiming(0, { duration: 180 });
    })
    .onFinalize((_, success) => {
      'worklet';
      if (!success) {
        runOnJS(setPointer)(null);
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        lifted.value = withTiming(0, { duration: 180 });
      }
    });

  const gesture = Gesture.Simultaneous(longPress, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: 1 + (LIFT_SCALE - 1) * lifted.value },
    ],
    zIndex: lifted.value > 0 ? 1000 : 0,
    elevation: lifted.value > 0 ? 8 : 0,
  }));

  return (
    <DraggableContext.Provider value={{ gesture, disabled }}>
      <Animated.View style={[style, animatedStyle]} collapsable={false}>
        {children}
      </Animated.View>
    </DraggableContext.Provider>
  );
}

type DragHandleProps = {
  /** Defaults to "Reorder". The integrator should pass something more
   *  specific (e.g. the task title) so screen-reader users know which
   *  row the handle belongs to. */
  accessibilityLabel?: string;
  /** Override the default Ionicons grip. Pass any node that visually
   *  reads as a handle; the gesture wrapping happens around whatever
   *  you pass. */
  children?: ReactNode;
  style?: ViewStyle;
  /** Visual size of the default icon. Hit area is enlarged via
   *  hitSlop regardless. */
  iconSize?: number;
  iconColor?: string;
};

export function DragHandle({
  accessibilityLabel = 'Reorder',
  children,
  style,
  iconSize = 18,
  iconColor = '#999',
}: DragHandleProps) {
  const ctx = useContext(DraggableContext);
  if (!ctx) {
    // Without a Draggable ancestor the handle is a no-op. Render the
    // visual but skip the gesture wrapper so the parent layout still
    // looks right (e.g. column placement).
    return (
      <View style={style}>
        {children ?? (
          <Ionicons name="reorder-three-outline" size={iconSize} color={iconColor} />
        )}
      </View>
    );
  }
  return (
    <GestureDetector gesture={ctx.gesture}>
      <View
        style={[{ paddingHorizontal: 8, paddingVertical: 6 }, style]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Long-press, then drag to a folder to move."
        // RN-Web exposes hitSlop on Pressable, not View; the wrapping
        // padding above gives a 32×32 effective tap target.
        collapsable={false}
      >
        {children ?? (
          <Ionicons name="reorder-three-outline" size={iconSize} color={iconColor} />
        )}
      </View>
    </GestureDetector>
  );
}
