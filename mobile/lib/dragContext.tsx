/**
 * Drag context — registry of drop targets + active-drag state.
 *
 * Mounted via `<DragProvider>` around any region that hosts
 * `<Draggable>` rows and `<DropTarget>` zones. Children `useDrag()`
 * to read the active drag state (e.g. to highlight the active drop
 * target's header).
 *
 * The provider stores drop targets in a Map keyed by id. Each
 * `<DropTarget>` registers/unregisters via the imperative
 * `registerTarget` / `unregisterTarget` API, NOT React state, so a
 * mid-render scroll doesn't trigger a remount-cascade. The geometry
 * helpers in `dragGeometry.ts` consume the rect snapshot.
 *
 * Active-drag state IS in React state (so headers can re-render to
 * highlight when their id is the active target) — but it's
 * coalesced via requestAnimationFrame to avoid a state set per
 * gesture-frame. ~60 setState calls/sec is the cap, not 120+.
 */

import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import type { Rect } from './dragGeometry';
import { findActiveTarget } from './dragGeometry';

type RegisteredTarget = { id: string; rect: Rect };

type DragApi = {
  /** Register a drop target's rect. Returns the unregister fn so a
   *  component can call `useEffect(() => registerTarget(...), [])`
   *  with the cleanup naturally typed. */
  registerTarget: (id: string, rect: Rect) => () => void;
  /** Update an existing target's rect (e.g. after scroll or layout
   *  shift). No-op if id isn't registered. */
  updateTarget: (id: string, rect: Rect) => void;
  /** True iff `id` is the currently-active drop target (highlighted). */
  isActiveTarget: (id: string) => boolean;
  /** Active target id from the Draggable's perspective. Used by the
   *  Draggable itself; rarely needed by other consumers. */
  setPointer: (point: { x: number; y: number } | null) => void;
  /** Synchronous lookup: return the id of the target containing the
   *  given window-coord point right now, bypassing the rAF-coalesced
   *  active-target state. The Draggable's drop handler calls this at
   *  gesture-end to commit the right target even if active state is
   *  one frame stale. Pure read of the targets registry. */
  resolveTargetAt: (point: { x: number; y: number }) => string | null;
};

const DragContext = createContext<DragApi | null>(null);

export function DragProvider({ children }: { children: ReactNode }) {
  // Targets stored in a ref'd Map so register/unregister doesn't
  // trigger a re-render cascade. The active-target id IS in React
  // state, so consumers re-render on highlight changes.
  const targetsRef = useRef(new Map<string, RegisteredTarget>());
  const [activeId, setActiveId] = useState<string | null>(null);

  // rAF-coalesced active-target update. setPointer can fire 60-120
  // times/sec from the gesture-handler worklet via runOnJS; without
  // coalescing we'd schedule a re-render on each frame.
  const rafRef = useRef<number | null>(null);
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null);

  const registerTarget = useCallback((id: string, rect: Rect) => {
    targetsRef.current.set(id, { id, rect });
    return () => {
      targetsRef.current.delete(id);
    };
  }, []);

  const updateTarget = useCallback((id: string, rect: Rect) => {
    const existing = targetsRef.current.get(id);
    if (existing) {
      existing.rect = rect;
    }
  }, []);

  const setPointer = useCallback((point: { x: number; y: number } | null) => {
    pendingPointRef.current = point;
    if (rafRef.current !== null) return;
    // Native and web both support requestAnimationFrame. On web it's
    // the browser's; on native, RN polyfills it.
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = pendingPointRef.current;
      if (!p) {
        setActiveId((prev) => (prev === null ? prev : null));
        return;
      }
      const targets = Array.from(targetsRef.current.values());
      const next = findActiveTarget(p, targets);
      setActiveId((prev) => (prev === next ? prev : next));
    });
  }, []);

  const isActiveTarget = useCallback(
    (id: string) => activeId === id,
    [activeId],
  );

  const resolveTargetAt = useCallback((point: { x: number; y: number }) => {
    const targets = Array.from(targetsRef.current.values());
    return findActiveTarget(point, targets);
  }, []);

  // Memoize the api so context consumers don't re-render purely
  // because the provider re-rendered with a new object reference.
  const api = useMemo<DragApi>(
    () => ({ registerTarget, updateTarget, isActiveTarget, setPointer, resolveTargetAt }),
    [registerTarget, updateTarget, isActiveTarget, setPointer, resolveTargetAt],
  );

  return <DragContext.Provider value={api}>{children}</DragContext.Provider>;
}

export function useDrag(): DragApi {
  const ctx = useContext(DragContext);
  if (!ctx) {
    throw new Error('useDrag() must be used inside <DragProvider>');
  }
  return ctx;
}
