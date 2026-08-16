'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Form primitives.
 *
 * Every control gets a real `<label for>` (never a placeholder standing in for
 * one), and errors are wired through `aria-describedby` + `aria-invalid` so a
 * screen reader announces them.
 */

const controlBase =
  'w-full rounded-[var(--radius-control)] border bg-white px-3 py-2 text-sm text-ink-900 ' +
  'shadow-raised transition-colors placeholder:text-ink-400 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ' +
  // A disabled control must not look merely "greyer" than an empty one, so it
  // also loses its shadow and takes a not-allowed cursor.
  'disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-500 disabled:shadow-none ' +
  'read-only:bg-ink-50';

const controlState = (invalid?: boolean) =>
  invalid
    ? 'border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500/40'
    : 'border-ink-300 hover:border-ink-400 focus-visible:border-brand-500 focus-visible:ring-brand-500/40';

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | string[] | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Live counter shown at the right of the label row (e.g. "48 / 60"). */
  counter?: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
  counter,
}: FieldProps) {
  const messages = Array.isArray(error) ? error : error ? [error] : [];

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        {/* The required marker sits outside <label> deliberately: inside, it
            would become part of the label's text ("Password Required"), which
            reads badly aloud and breaks exact label matching in tests. */}
        <span className="flex items-baseline">
          <label htmlFor={htmlFor} className="text-ink-800 block text-sm font-medium">
            {label}
          </label>
          {/* A word beats an asterisk: users routinely miss or misread `*`, and
              this sits outside <label> so it never joins the accessible name. */}
          {required ? (
            <span className="text-ink-500 ml-2 text-[0.6875rem] font-medium tracking-wide uppercase">
              Required
            </span>
          ) : null}
        </span>
        {counter ? <span className="text-ink-500 text-xs tabular-nums">{counter}</span> : null}
      </div>

      {children}

      {/* Help text stays visible next to the control rather than living in a
          placeholder, which disappears the moment the user starts typing. */}
      {hint && messages.length === 0 ? (
        <p id={`${htmlFor}-hint`} className="text-ink-500 text-xs leading-relaxed">
          {hint}
        </p>
      ) : null}

      {messages.length > 0 ? (
        <ul id={`${htmlFor}-error`} className="space-y-1">
          {messages.map((message) => (
            <li key={message} className="flex items-start gap-1.5 text-xs font-medium text-red-700">
              {/* An icon as well as colour, so the error is not signalled by
                  colour alone. */}
              <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, id, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : id ? `${id}-hint` : undefined}
      className={cn(controlBase, controlState(invalid), 'h-10', className)}
      {...props}
    />
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, id, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : id ? `${id}-hint` : undefined}
      className={cn(controlBase, controlState(invalid), 'min-h-24 resize-y', className)}
      {...props}
    />
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, id, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : undefined}
      className={cn(controlBase, controlState(invalid), 'h-10 pr-8', className)}
      {...props}
    >
      {children}
    </select>
  );
});

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  description?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref,
) {
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="border-ink-300 text-brand-600 accent-brand-600 mt-0.5 h-4 w-4 shrink-0 rounded"
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-ink-800 block text-sm font-medium">
          {label}
        </label>
        {description ? <p className="text-ink-500 text-xs">{description}</p> : null}
      </div>
    </div>
  );
});
