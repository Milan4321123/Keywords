'use client';

import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';

interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  /** Tailwind classes for the chip color scheme. */
  tone?: 'blue' | 'amber' | 'slate';
  /** Optional element rendered to the right of the input (e.g. a voice button). */
  action?: React.ReactNode;
}

const TONES = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
};

/**
 * Tag-style input: type and press Enter (or comma) to add a chip,
 * Backspace on an empty field removes the last one. Much friendlier
 * than a separate text field + "Add" button per item.
 */
export default function ChipInput({
  values,
  onChange,
  placeholder,
  tone = 'slate',
  action,
}: ChipInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const part of parts) {
      if (!next.includes(part)) next.push(part);
    }
    onChange(next);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex flex-wrap items-center gap-2 min-h-[3rem] w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-300 transition-all cursor-text"
    >
      {values.map((value, i) => (
        <span
          key={`${value}-${i}`}
          className={`inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-lg border text-sm font-medium ${TONES[tone]}`}
        >
          {value}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(values.filter((_, idx) => idx !== i));
            }}
            className="text-current opacity-50 hover:opacity-100 transition-opacity"
            aria-label={`Remove ${value}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent border-none focus:ring-0 text-sm text-slate-900 placeholder-slate-400 p-0"
      />
      {action}
    </div>
  );
}
