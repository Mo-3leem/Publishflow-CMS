'use client';

import * as React from 'react';
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  Link2,
  Code,
  Quote,
  Eye,
  Pencil,
  Columns2,
} from 'lucide-react';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';

/**
 * Markdown editor with a formatting toolbar and preview.
 *
 * The preview uses the exact same renderer as the public page, so what an author
 * sees here is what visitors get — including the fact that raw HTML is escaped.
 */

type Mode = 'write' | 'preview' | 'split';

interface ToolbarAction {
  label: string;
  icon: React.ElementType;
  /** Wrap the selection, or insert at the caret when nothing is selected. */
  apply: (selected: string) => { text: string; cursorOffset: number };
}

const ACTIONS: ToolbarAction[] = [
  {
    label: 'Bold',
    icon: Bold,
    apply: (s) => ({ text: `**${s || 'bold text'}**`, cursorOffset: 2 }),
  },
  {
    label: 'Italic',
    icon: Italic,
    apply: (s) => ({ text: `_${s || 'italic text'}_`, cursorOffset: 1 }),
  },
  {
    label: 'Heading',
    icon: Heading2,
    apply: (s) => ({ text: `## ${s || 'Heading'}`, cursorOffset: 3 }),
  },
  {
    label: 'Bulleted list',
    icon: List,
    apply: (s) => ({
      text: (s || 'List item')
        .split('\n')
        .map((line) => `- ${line}`)
        .join('\n'),
      cursorOffset: 2,
    }),
  },
  {
    label: 'Numbered list',
    icon: ListOrdered,
    apply: (s) => ({
      text: (s || 'List item')
        .split('\n')
        .map((line, index) => `${index + 1}. ${line}`)
        .join('\n'),
      cursorOffset: 3,
    }),
  },
  {
    label: 'Link',
    icon: Link2,
    apply: (s) => ({ text: `[${s || 'link text'}](https://)`, cursorOffset: 1 }),
  },
  {
    label: 'Inline code',
    icon: Code,
    apply: (s) => ({ text: `\`${s || 'code'}\``, cursorOffset: 1 }),
  },
  {
    label: 'Quote',
    icon: Quote,
    apply: (s) => ({ text: `> ${s || 'Quoted text'}`, cursorOffset: 2 }),
  },
];

export interface MarkdownEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  placeholder?: string;
  minRows?: number;
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  invalid,
  placeholder,
  minRows = 18,
}: MarkdownEditorProps) {
  const [mode, setMode] = React.useState<Mode>('write');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const applyAction = (action: ToolbarAction) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const { text, cursorOffset } = action.apply(selected);

    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    onChange(next);

    // Restore a sensible selection so the author can keep typing.
    requestAnimationFrame(() => {
      textarea.focus();
      if (selected) {
        textarea.setSelectionRange(start + cursorOffset, start + cursorOffset + selected.length);
      } else {
        textarea.setSelectionRange(start + cursorOffset, start + text.length - cursorOffset);
      }
    });
  };

  const modes: Array<{ value: Mode; label: string; icon: React.ElementType }> = [
    { value: 'write', label: 'Write', icon: Pencil },
    { value: 'preview', label: 'Preview', icon: Eye },
    { value: 'split', label: 'Split', icon: Columns2 },
  ];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-white shadow-sm',
        invalid ? 'border-red-400' : 'border-ink-300',
      )}
    >
      <div className="border-ink-200 bg-ink-50 flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5">
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => applyAction(action)}
                title={action.label}
                aria-label={action.label}
                disabled={mode === 'preview'}
                className="text-ink-600 hover:bg-ink-200 hover:text-ink-900 rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        <div
          role="group"
          aria-label="Editor view"
          className="bg-ink-200/70 flex items-center gap-0.5 rounded-lg p-0.5"
        >
          {modes.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setMode(item.value)}
                aria-pressed={mode === item.value}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  mode === item.value
                    ? 'text-ink-900 bg-white shadow-sm'
                    : 'text-ink-600 hover:text-ink-900',
                  item.value === 'split' && 'hidden lg:inline-flex',
                )}
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={cn('grid', mode === 'split' && 'lg:divide-ink-200 lg:grid-cols-2 lg:divide-x')}
      >
        <div className={cn(mode === 'preview' && 'hidden')}>
          <textarea
            ref={textareaRef}
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={minRows}
            placeholder={placeholder}
            spellCheck
            aria-invalid={invalid || undefined}
            className="text-ink-900 placeholder:text-ink-400 w-full resize-y border-0 px-4 py-3 font-mono text-sm leading-relaxed focus:outline-none"
          />
        </div>

        {mode !== 'write' ? (
          <div className="max-h-[46rem] overflow-y-auto bg-white px-4 py-3">
            {value.trim().length === 0 ? (
              <p className="text-ink-400 text-sm">Nothing to preview yet.</p>
            ) : (
              <Markdown content={value} />
            )}
          </div>
        ) : null}
      </div>

      <p className="border-ink-200 bg-ink-50 text-ink-500 border-t px-3 py-1.5 text-xs">
        Markdown with GitHub-flavoured tables. Raw HTML is escaped, not rendered.
      </p>
    </div>
  );
}
