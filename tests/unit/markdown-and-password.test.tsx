// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '@/components/markdown';
import { validatePasswordPolicy } from '@/server/auth/password';
import { deriveExcerpt } from '@/lib/utils';
import { toFtsQuery } from '@/server/services/search-service';

describe('Markdown rendering is XSS-safe', () => {
  it('does not execute or inject a raw <script> tag', () => {
    const { container } = render(
      <Markdown content={'Hello\n\n<script>window.__pwned = true;</script>\n\nWorld'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // The tag survives as visible text, which is the safe outcome.
    expect(container.textContent).toContain('<script>');
  });

  it('does not render raw HTML elements from post content', () => {
    const { container } = render(<Markdown content={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not render an iframe', () => {
    const { container } = render(
      <Markdown content={'<iframe src="https://evil.test"></iframe>'} />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('strips a javascript: link but keeps its text', () => {
    const { container } = render(<Markdown content={'[click me](javascript:alert(1))'} />);
    const anchor = container.querySelector('a');
    // Either the anchor is dropped entirely, or it carries no dangerous href.
    expect(anchor?.getAttribute('href') ?? '').not.toContain('javascript:');
    expect(container.textContent).toContain('click me');
  });

  it('renders a safe external link with rel protections', () => {
    const { container } = render(<Markdown content={'[docs](https://example.com/docs)'} />);
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/docs');
    expect(anchor?.getAttribute('rel')).toContain('noopener');
    expect(anchor?.getAttribute('target')).toBe('_blank');
  });

  it('renders ordinary Markdown structure', () => {
    render(<Markdown content={'# Title\n\n- one\n- two\n\n**bold**'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders GitHub-flavoured tables', () => {
    const { container } = render(<Markdown content={'| a | b |\n| --- | --- |\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).not.toBeNull();
  });
});

describe('password policy', () => {
  it('requires at least 12 characters', () => {
    expect(validatePasswordPolicy('short').ok).toBe(false);
    expect(validatePasswordPolicy('exactly12chr').ok).toBe(true);
  });

  it('rejects blank and whitespace-only passwords', () => {
    expect(validatePasswordPolicy('            ').ok).toBe(false);
  });

  it('rejects very common passwords', () => {
    expect(validatePasswordPolicy('passwordpassword').ok).toBe(false);
    expect(validatePasswordPolicy('PasswordPassword').ok).toBe(false);
  });

  it('rejects absurdly long passwords', () => {
    expect(validatePasswordPolicy('a'.repeat(500)).ok).toBe(false);
  });

  it('accepts a reasonable passphrase without demanding symbol classes', () => {
    const result = validatePasswordPolicy('correct horse battery staple');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('deriveExcerpt', () => {
  it('strips Markdown syntax', () => {
    expect(deriveExcerpt('## Heading\n\nSome **bold** and `code` text.')).toBe(
      'Heading Some bold and text.',
    );
  });

  it('keeps link text but drops the URL', () => {
    expect(deriveExcerpt('See [the docs](https://example.com) now.')).toBe('See the docs now.');
  });

  it('truncates on a word boundary with an ellipsis', () => {
    const result = deriveExcerpt('word '.repeat(100), 40);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('FTS query escaping', () => {
  it('quotes each token so FTS operators are treated literally', () => {
    expect(toFtsQuery('optimistic locking')).toBe('"optimistic"* AND "locking"*');
  });

  it('neutralises FTS syntax typed by a visitor', () => {
    const built = toFtsQuery('foo OR bar NEAR baz');
    // Every token is quoted, so OR/NEAR cannot act as operators.
    expect(built).toBe('"foo"* AND "OR"* AND "bar"* AND "NEAR"* AND "baz"*');
  });

  it('drops punctuation that would otherwise break the MATCH expression', () => {
    expect(toFtsQuery('"; DROP TABLE posts; --')).toBe('"DROP"* AND "TABLE"* AND "posts"*');
  });

  it('returns null when nothing searchable remains', () => {
    expect(toFtsQuery('!!! ???')).toBeNull();
    expect(toFtsQuery('')).toBeNull();
  });

  it('caps the number of tokens', () => {
    const many = Array.from({ length: 40 }, (_, index) => `t${index}`).join(' ');
    expect((toFtsQuery(many) ?? '').split(' AND ')).toHaveLength(12);
  });
});
