import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseNumber, roundTo } from '../lib/units';

/** Formats with `decimals`, but shows one more decimal if needed to not hide a value like 3.15. */
export function formatSmart(value: number, decimals = 1): string {
  const extra = roundTo(value, decimals + 1);
  const d = roundTo(value, decimals) === extra ? decimals : decimals + 1;
  const v = roundTo(value, d);
  return (Object.is(v, -0) ? 0 : v).toFixed(d);
}

interface NumberFieldProps {
  value: number;
  onCommit: (value: number) => string | null | void;
  /** Text shown while not editing. */
  format?: (value: number) => string;
  unit?: string;
  width?: number;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  /** Allowed range for plain validation. */
  min?: number;
  max?: number;
}

/**
 * Text-based numeric input. Commits on Enter or blur; Escape reverts.
 * Invalid input is highlighted and not committed.
 */
export function NumberField({ value, onCommit, format = (v) => formatSmart(v), unit, width = 76, disabled, title, ariaLabel, min, max }: NumberFieldProps) {
  const shown = format(value);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setText(shown);
      setError(null);
    }
  }, [shown]);

  const commit = () => {
    editing.current = false;
    if (text === shown) {
      setError(null);
      return;
    }
    const n = parseNumber(text);
    if (n === null) {
      setError('数値を入力してください');
      return;
    }
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
      setError(`${min ?? ''}〜${max ?? ''} の範囲で入力してください`);
      return;
    }
    const err = onCommit(n);
    if (typeof err === 'string') {
      setError(err);
      return;
    }
    setError(null);
  };

  return (
    <span className="numfield">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        style={{ width }}
        disabled={disabled}
        title={error ?? title}
        aria-label={ariaLabel}
        aria-invalid={!!error}
        className={error ? 'invalid' : undefined}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => {
          editing.current = true;
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Blur commits (see onBlur).
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            editing.current = false;
            setText(format(value));
            setError(null);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h2>{title}</h2>
        {actions}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <span className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : undefined}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
