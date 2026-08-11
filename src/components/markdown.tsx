import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isSafeExternalUrl, isSafeInternalPath } from '@/lib/url-safety';
import { cn } from '@/lib/utils';

/**
 * Markdown renderer.
 *
 * Safety properties:
 *  - No `rehype-raw`. Raw HTML in post content is escaped and rendered as text,
 *    so `<script>` or `<img onerror>` in a post body cannot execute.
 *  - `dangerouslySetInnerHTML` is never used.
 *  - Link and image URLs are re-checked here as well as at write time, because
 *    content can predate a validation change.
 */

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (trimmed.startsWith('#')) return trimmed;
  if (isSafeInternalPath(trimmed) || isSafeExternalUrl(trimmed)) return trimmed;
  return null;
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('prose-article', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // `urlTransform` is react-markdown's own sanitiser; returning '' drops
        // the attribute entirely for anything not on the allow-list.
        urlTransform={(url) => safeHref(url) ?? ''}
        components={{
          a({ href, children, ...props }) {
            const target = safeHref(href);
            if (!target) return <span>{children}</span>;
            const external = isSafeExternalUrl(target);
            return (
              <a
                href={target}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
                {...props}
              >
                {children}
                {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
              </a>
            );
          },
          img({ src, alt, ...props }) {
            const target = typeof src === 'string' ? safeHref(src) : null;
            if (!target) return null;
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={target} alt={alt ?? ''} loading="lazy" {...props} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
