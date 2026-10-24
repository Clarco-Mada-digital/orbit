import ReactMarkdown from 'react-markdown';
import {
  assistantRehypePlugins,
  assistantRemarkPlugins,
  transformAssistantMarkdownUrl,
} from '../lib/assistantMarkdown';
import { safeHref } from '../lib/markdown';
import 'katex/dist/katex.min.css';

function AssistantMarkdown({ content }) {
  return (
    <div className="assistant-markdown min-w-0 break-words text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={assistantRemarkPlugins}
        rehypePlugins={assistantRehypePlugins}
        urlTransform={transformAssistantMarkdownUrl}
        components={{
          h1: ({ children }) => <h1 className="mb-3 mt-5 text-xl font-bold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-2 mt-3 font-semibold">{children}</h4>,
          h5: ({ children }) => <h5 className="mb-2 mt-3 text-sm font-semibold">{children}</h5>,
          h6: ({ children }) => <h6 className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{children}</h6>,
          p: ({ children }) => <p className="mb-3 whitespace-pre-wrap last:mb-0">{children}</p>,
          a: ({ href, children }) => {
            const safeUrl = safeHref(href);
            if (!safeUrl || safeUrl.startsWith('mailto:')) {
              return <span>{children}</span>;
            }
            const external = /^https?:\/\//i.test(safeUrl);
            return (
              <a
                href={safeUrl}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                className="underline decoration-current/40 underline-offset-2 hover:decoration-current"
              >
                {children}
              </a>
            );
          },
          ul: ({ children, className }) => (
            <ul className={`mb-3 list-disc space-y-1 pl-6 last:mb-0 ${className || ''}`}>{children}</ul>
          ),
          ol: ({ children, className }) => (
            <ol className={`mb-3 list-decimal space-y-1 pl-6 last:mb-0 ${className || ''}`}>{children}</ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          input: ({ checked, type }) => (
            <input
              type={type}
              checked={checked}
              readOnly
              disabled
              className="mr-2 align-middle accent-accent-primary"
            />
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-accent-primary/50 pl-4 text-text-muted">{children}</blockquote>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          del: ({ children }) => <del className="text-text-muted">{children}</del>,
          code: ({ children, className }) => (
            <code className={className
              ? `${className} rounded bg-bg-primary/70 px-1.5 py-0.5 font-mono text-[0.9em] text-text-primary`
              : 'rounded bg-bg-primary/70 px-1.5 py-0.5 font-mono text-[0.9em] text-text-primary'}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-3 max-w-full overflow-x-auto rounded-lg border border-border bg-bg-primary/80 p-3 text-xs leading-5">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-bg-primary/70 text-text-primary">{children}</thead>,
          th: ({ children }) => <th className="border-b border-border px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-t border-border/70 px-3 py-2">{children}</td>,
          hr: () => <hr className="my-4 border-border" />,
          img: ({ alt }) => alt
            ? <span className="rounded bg-bg-primary/70 px-1.5 py-0.5 text-xs text-text-muted">{alt}</span>
            : null,
        }}
      >
        {String(content ?? '')}
      </ReactMarkdown>
    </div>
  );
}

export default AssistantMarkdown;
