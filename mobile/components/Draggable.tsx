/**
 * Draggable — wraps a single row that the user can long-press +
 * drag to a registered DropTarget.
 *
 * Cross-platform via react-native-gesture-handler (installed in
 * PR-D0). Composition: LongPress (350ms) ARMs the drag; once armed,
 * Pan reports finger position frame-by-frame; gesture-end resolves
 * the drop target via DragProvider's resolveTargetAt. The active-
 * target highlight is driven by setPointer() on each pan frame
 * (rAF-coalesced inside the provider).
 *
 * Activation gate (per the 5-agent plan review's hard requirements):
 *  - 350ms long-press to ARM (matches iOS native press-and-hold UX,
 *    enough to disambiguate from a tap-to-edit but not so long that
 *    it feels sluggish).
 *  - 8pt minimum travel before the row visually lifts. Below that,
 *    the gesture is treated as a long-press-without-drag and a
 *    contextual menu can fire instead (PR-D3+ may use this).
 *
 * Reduce-motion respected via Reanimated's `withTiming` config —
 * see `liftAnim` below. The dragged row uses `pointerEvents="none"`
 * so taps during the drop animation can't fire the underlying row's
 * onPress (a known nested-Pressable trap on RN-Web).
 *
 * NOT in scope for PR-D2 (deferred to PR-D3+):
 *  - Edge-of-scroller auto-scroll (geometry helper exists in
 *    dragGeometry.ts; integration is the integrating screen's job
 *    once we know which scroller we're inside).
 *  - The drop animation's spring vs snap split based on
 *    AccessibilityInfo.isReduceMotionEnabled().
 *  - Multi-select drag.
 *
 * Web parity caveat: Reanimated worklets on RN-Web run on the JS
 * thread (web has no UI thread). At 60fps with `useMemo` on the
 * surrounding list this can drop frames. Acceptable for v1; revisit
 * if dogfood on iPad PWA shows visible jank.
 */
import { useCallback, useRef, type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated';
import { useDrag } from '@/lib/dragContext';

/** Tuning constants. Co-located so a future ergonomics tweak (e.g.
 *  shorter long-press for a power-user setting) only changes one
 *  place. The 5-agent review converged on these values. */
const LONG_PRESS_MS = 350;
const DRAG_ACTIVATION_DISTANCE = 8;  // pt — minimum travel before lift
const LIFT_SCALE = 1.04;

type DraggableProps<T> = {
  /** Opaque payload returned to onDrop. The integrator decides what
   *  to put here (e.g. the task or routine id, or the full row). */
  data: T;
  /** Called when the user releases over a registered DropTarget.
   *  `targetId === null` means released outside any target — the
   *  integrator should snap back / no-op. Always called on gesture-
   *  end, even on cancel. */
  onDrop: (data: T, targetId: string | null) => void;
  /** Optional. Called the moment the long-press ARMs the drag,
   *  before any movement. Useful for haptic feedback. */
  onDragStart?: () => void;
  /** Disable the gesture entirely. The row still renders but doesn't
   *  arm. Used for in-flight rows or rows the integrator wants to
   *  pin. */
  disabled?: boolean;
  /** Extra style on the wrapper. Useful for the integrator to set
   *  flex / margin without nesting another View. */
  style?: ViewStyle;
  children: ReactNode;
};

export function Draggable<T>({
  data, onDrop, onDragStart, disabled, style, children,
}: DraggableProps<T>) {
  const { setPointer, resolveTargetAt } = useDrag();
  // translateX/Y of the lifted row, in window coords. Reset on
  // gesture-end via withTiming so the row springs back to its
  // origin position.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);  // 0 = at rest, 1 = lifted

  // Ref-tracked latest data so an in-flight gesture commits the
  // current value (useful if the parent re-renders the row with a
  // new payload mid-drag — rare but possible).
  const dataRef = useRef(data);
  dataRef.current = data;

  // JS-callbacks — wrapped in useCallback so the worklets' captured
  // references stay stable between renders. runOnJS bridges the
  // worklet → JS thread (no-op on web; bridges to JS thread on
  // native).
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

  // LongPress arms the gesture; Pan provides position. Compose
  // simultaneously so the pan begins as soon as the long-press
  // resolves, with no perceptible second activation.
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
      // absoluteX/Y are window coords — same space as our DropTarget
      // rects, so no conversion needed.
      runOnJS(handleMove)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      'worklet';
      runOnJS(handleEnd)(e.absoluteX, e.absoluteY);
      tx.value = withTiming(0, { duration: 180 });
      ty.value = withTiming(0, { duration: 180 });
      lifted.value = withTiming(0, { duration: 180 });
    })
    .onFinalize((e, success) => {
      'worklet';
      // Cancel path (e.g. pointer interrupted). Snap back without
      // calling onDrop again — onEnd already handled the success
      // case if it ran first.
      if (!success) {
        runOnJS(setPointer)(null);
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        lifted.value = withTiming(0, { duration: 180 });
      }
    });

  const composed = Gesture.Simultaneous(longPress, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: 1 + (LIFT_SCALE - 1) * lifted.value },
    ],
    // Lift the row above its siblings during drag so the elevated
    // shadow (added by the integrator via style) reads correctly,
    // and so RN-Web's pointer-event chain doesn't dispatch through
    // the lifted card to a sibling.
    zIndex: lifted.value > 0 ? 1000 : 0,
    elevation: lifted.value > 0 ? 8 : 0,
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[style, animatedStyle]} collapsable={false}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
