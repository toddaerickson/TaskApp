/**
 * Global undo snackbar — pure reducer + types.
 *
 * The "5-second grace period" state machine for destructive actions.
 * Callers don't persist the destructive write until the timer expires;
 * if the user taps Undo before expiry the original action is abandoned
 * (no server round-trip).
 *
 * Kept in a .ts file (no JSX) so jest can cover the reducer without
 * pulling in the RN runtime. The React provider + view live in
 * components/UndoSnackbar.tsx.
 */

/** How long the user has to tap Undo before the destructive action commits. */
export const UNDO_WINDOW_MS = 5000;

export interface UndoEntry {
  /** Monotonic id for diffing + cancel-by-id. Never reused. */
  id: number;
  message: string;
  /** Called when the user taps Undo. Entry is removed; onTimeout is NOT fired. */
  onUndo?: () => void;
  /** Called when the timer expires and the entry auto-dismisses. This is
   *  where the caller should commit the destructive write (DELETE / etc). */
  onTimeout?: () => void;
}

export interface UndoState {
  current: UndoEntry | null;
  /** Last id handed out; used so the next entry gets a unique id even
   *  across rapid show()s. */
  nextId: number;
}

export const initialUndoState: UndoState = { current: null, nextId: 1 };

export type UndoAction =
  | { type: 'show'; message: string; onUndo?: () => void; onTimeout?: () => void }
  | { type: 'undo' }
  | { type: 'timeout' }
  | { type: 'dismiss' };

/**
 * Reducer. Show while another is active replaces it — the displaced
 * entry's onTimeout fires immediately so its destructive action commits
 * (we don't want a second show() to silently drop the first user's
 * deletion).
 *
 * onUndo / onTimeout callbacks are invoked as a side effect during the
 * reduce; the caller is expected to be idempotent with them (no
 * strict-mode double-invoke risk because each entry fires its callback
 * exactly once — either on undo, on timeout, or when displaced).
 */
export function undoReducer(state: UndoState, action: UndoAction): UndoState {
  switch (action.type) {
    case 'show': {
      if (state.current) {
        state.current.onTimeout?.();
      }
      return {
        current: {
          id: state.nextId,
          message: action.message,
          onUndo: action.onUndo,
          onTimeout: action.onTimeout,
        },
        nextId: state.nextId + 1,
      };
    }
    case 'undo': {
      if (!state.current) return state;
      state.current.onUndo?.();
      return { ...state, current: null };
    }
    case 'timeout': {
      if (!state.current) return state;
      state.current.onTimeout?.();
      return { ...state, current: null };
    }
    case 'dismiss':
      return { ...state, current: null };
    default:
      return state;
  }
}
