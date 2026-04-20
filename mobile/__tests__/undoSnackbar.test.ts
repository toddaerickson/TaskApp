import {
  undoReducer, initialUndoState, UndoState, UndoAction,
} from '@/lib/undoSnackbar';

function reduce(state: UndoState, ...actions: UndoAction[]): UndoState {
  return actions.reduce(undoReducer, state);
}

describe('undoReducer', () => {
  test('show inserts the first entry with id=1', () => {
    const s = undoReducer(initialUndoState, { type: 'show', message: 'Set deleted' });
    expect(s.current?.id).toBe(1);
    expect(s.current?.message).toBe('Set deleted');
    expect(s.nextId).toBe(2);
  });

  test('undo removes the current entry and invokes onUndo', () => {
    const onUndo = jest.fn();
    const s1 = undoReducer(initialUndoState, { type: 'show', message: 'x', onUndo });
    const s2 = undoReducer(s1, { type: 'undo' });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(s2.current).toBeNull();
  });

  test('timeout removes the current entry and invokes onTimeout', () => {
    const onTimeout = jest.fn();
    const s1 = undoReducer(initialUndoState, { type: 'show', message: 'x', onTimeout });
    const s2 = undoReducer(s1, { type: 'timeout' });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(s2.current).toBeNull();
  });

  test('undo does not fire onTimeout', () => {
    const onUndo = jest.fn();
    const onTimeout = jest.fn();
    const s1 = undoReducer(initialUndoState, {
      type: 'show', message: 'x', onUndo, onTimeout,
    });
    undoReducer(s1, { type: 'undo' });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('showing a second entry fires the first entry\'s onTimeout', () => {
    // Displacing a still-live entry must commit its destructive action
    // — a new show() isn't a cancel, it's "too bad, the previous one
    // is done as if the timer had elapsed."
    const firstOnTimeout = jest.fn();
    const firstOnUndo = jest.fn();
    const secondOnTimeout = jest.fn();
    const s1 = undoReducer(initialUndoState, {
      type: 'show', message: 'first', onUndo: firstOnUndo, onTimeout: firstOnTimeout,
    });
    const s2 = undoReducer(s1, {
      type: 'show', message: 'second', onTimeout: secondOnTimeout,
    });
    expect(firstOnTimeout).toHaveBeenCalledTimes(1);
    expect(firstOnUndo).not.toHaveBeenCalled();
    expect(s2.current?.message).toBe('second');
    expect(s2.current?.id).toBe(2);
    expect(secondOnTimeout).not.toHaveBeenCalled(); // fires later on its own timer
  });

  test('dismiss clears current without firing any callback', () => {
    const onUndo = jest.fn();
    const onTimeout = jest.fn();
    const s1 = undoReducer(initialUndoState, {
      type: 'show', message: 'x', onUndo, onTimeout,
    });
    const s2 = undoReducer(s1, { type: 'dismiss' });
    expect(s2.current).toBeNull();
    expect(onUndo).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('undo on empty state is a no-op', () => {
    const s = undoReducer(initialUndoState, { type: 'undo' });
    expect(s).toEqual(initialUndoState);
  });

  test('nextId never regresses across show+undo+show', () => {
    const s = reduce(initialUndoState,
      { type: 'show', message: 'a' },
      { type: 'undo' },
      { type: 'show', message: 'b' },
    );
    expect(s.current?.id).toBe(2);
    expect(s.nextId).toBe(3);
  });
});
