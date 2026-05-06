/**
 * Drop target — wraps a region (typically a group header or a
 * group's row range) that accepts dropped Draggable items.
 *
 * Registers its window-coord rect with the DragProvider on layout.
 * On unmount, deregisters cleanly. The geometry helpers in
 * `dragGeometry.ts` then resolve "which target is the pointer over"
 * during a drag.
 *
 * The component itself doesn't render anything visible — it's a
 * transparent wrapper. The `children` decide their own appearance,
 * including any "this target is active" highlight via
 * `useDrag().isActiveTarget(id)`.
 *
 * Why use `measureInWindow` and not a layout state read: window
 * coords are absolute pixels on the screen, which is also what the
 * Pan gesture handler reports. Comparing them is the natural
 * coordinate space. Layout-relative coords would require knowing
 * the parent's offset, which we don't track.
 */
import {
  useEffect, useRef, type ReactNode,
} from 'react';
import { View } from 'react-native';
import { useDrag } from '@/lib/dragContext';

type DropTargetProps = {
  /** Stable unique id within the DragProvider scope. Use the same
   *  string the parent passes to `onDrop` so the integration code
   *  knows which target was hit. */
  id: string;
  children: ReactNode;
};

export function DropTarget({ id, children }: DropTargetProps) {
  const { registerTarget, updateTarget } = useDrag();
  const viewRef = useRef<View | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);

  // Capture the window rect on layout. measureInWindow is
  // asynchronous on native, synchronous-ish on web — the callback
  // is the only place RN gives us absolute window coords.
  const handleLayout = () => {
    if (!viewRef.current) return;
    viewRef.current.measureInWindow((x, y, width, height) => {
      const rect = { x, y, width, height };
      if (unregisterRef.current === null) {
        unregisterRef.current = registerTarget(id, rect);
      } else {
        updateTarget(id, rect);
      }
    });
  };

  // Clean up on unmount, even if onLayout never fired (rare, but
  // possible during fast nav). unregisterRef is null in that case
  // and the cleanup is a no-op.
  useEffect(() => {
    return () => {
      unregisterRef.current?.();
      unregisterRef.current = null;
    };
  }, []);

  return (
    <View
      ref={viewRef}
      onLayout={handleLayout}
      // Forward all touch events to children — DropTarget is purely
      // a measurement wrapper.
      collapsable={false}
    >
      {children}
    </View>
  );
}
