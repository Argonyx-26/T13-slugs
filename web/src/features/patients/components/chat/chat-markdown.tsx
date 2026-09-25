import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  p: ({ children }) => <p className='leading-relaxed [&:not(:first-child)]:mt-3'>{children}</p>,
  ul: ({ children }) => <ul className='mt-2 flex list-disc flex-col gap-1.5 pl-5'>{children}</ul>,
  ol: ({ children }) => <ol className='mt-2 flex list-decimal flex-col gap-1.5 pl-5'>{children}</ol>,
  li: ({ children }) => <li className='marker:text-muted-foreground leading-relaxed pl-0.5'>{children}</li>,
  strong: ({ children }) => <strong className='text-foreground font-semibold'>{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target='_blank' rel='noreferrer' className='underline underline-offset-3'>
      {children}
    </a>
  ),
  code: ({ children }) => <code className='bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]'>{children}</code>,
  h1: ({ children }) => <h3 className='mt-3 font-semibold'>{children}</h3>,
  h2: ({ children }) => <h3 className='mt-3 font-semibold'>{children}</h3>,
  h3: ({ children }) => <h3 className='mt-3 font-semibold'>{children}</h3>,
  table: ({ children }) => (
    <div className='mt-2 overflow-x-auto rounded-lg border'>
      <table className='w-full text-left text-xs'>{children}</table>
    </div>
  ),
  th: ({ children }) => <th className='bg-muted px-2 py-1.5 font-medium'>{children}</th>,
  td: ({ children }) => <td className='border-t px-2 py-1.5'>{children}</td>
};

export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className='text-sm'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
