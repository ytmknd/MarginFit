import { useCallback, useMemo, useReducer } from 'react';
import { computeLayout, initialAdjust, validateAdjust, type Adjust, type Layout, type SourceGeometry } from '../lib/geometry';
import { sourceGeometry, type LoadedFile } from '../lib/loader';

const HISTORY_LIMIT = 300;

interface State {
  file: LoadedFile | null;
  source: SourceGeometry | null;
  initial: Adjust | null;
  past: Adjust[];
  present: Adjust | null;
  future: Adjust[];
}

type Action =
  | { type: 'load'; file: LoadedFile; prepare?: (src: SourceGeometry, adj: Adjust) => Adjust }
  | { type: 'apply'; adjust: Adjust }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

const EMPTY: State = { file: null, source: null, initial: null, past: [], present: null, future: [] };

function sameAdjust(a: Adjust, b: Adjust) {
  return (Object.keys(a) as (keyof Adjust)[]).every((k) => a[k] === b[k]);
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'load': {
      const source = sourceGeometry(a.file);
      const initial = initialAdjust(source);
      // An optional first edit (e.g. "fit to A4") becomes one undoable step after the load.
      const prepared = a.prepare?.(source, initial);
      if (prepared && !validateAdjust(source, prepared) && !sameAdjust(prepared, initial)) {
        return { file: a.file, source, initial, past: [initial], present: prepared, future: [] };
      }
      return { file: a.file, source, initial, past: [], present: initial, future: [] };
    }
    case 'apply':
      if (!s.present || sameAdjust(s.present, a.adjust)) return s;
      return { ...s, past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: a.adjust, future: [] };
    case 'undo': {
      if (!s.present || s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future] };
    }
    case 'redo': {
      if (!s.present || s.future.length === 0) return s;
      const [next, ...rest] = s.future;
      return { ...s, past: [...s.past, s.present], present: next, future: rest };
    }
    case 'reset':
      if (!s.initial || !s.present || sameAdjust(s.present, s.initial)) return s;
      return { ...s, past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: s.initial, future: [] };
  }
}

export interface Editor {
  file: LoadedFile | null;
  source: SourceGeometry | null;
  adjust: Adjust | null;
  initial: Adjust | null;
  layout: Layout | null;
  canUndo: boolean;
  canRedo: boolean;
  isModified: boolean;
  /** Loads a file. `prepare` optionally applies a first edit (undoable) to the freshly loaded state. */
  load: (file: LoadedFile, prepare?: (src: SourceGeometry, adj: Adjust) => Adjust) => void;
  /** Applies an edit; returns an error message if the result is invalid (and then does nothing). */
  apply: (fn: (src: SourceGeometry, adj: Adjust) => Adjust) => string | null;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

export function useEditor(): Editor {
  const [s, dispatch] = useReducer(reducer, EMPTY);

  const layout = useMemo(() => (s.source && s.present ? computeLayout(s.source, s.present) : null), [s.source, s.present]);

  const apply = useCallback(
    (fn: (src: SourceGeometry, adj: Adjust) => Adjust) => {
      if (!s.source || !s.present) return null;
      const next = fn(s.source, s.present);
      const err = validateAdjust(s.source, next);
      if (err) return err;
      dispatch({ type: 'apply', adjust: next });
      return null;
    },
    [s.source, s.present],
  );

  return {
    file: s.file,
    source: s.source,
    adjust: s.present,
    initial: s.initial,
    layout,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    isModified: !!s.present && !!s.initial && !sameAdjust(s.present, s.initial),
    load: useCallback(
      (file: LoadedFile, prepare?: (src: SourceGeometry, adj: Adjust) => Adjust) => dispatch({ type: 'load', file, prepare }),
      [],
    ),
    apply,
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    reset: useCallback(() => dispatch({ type: 'reset' }), []),
  };
}
