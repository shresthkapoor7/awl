import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.css";

export function MarkdownMessage({
  text,
  onOpenLink,
}: {
  text: string;
  onOpenLink: (url: string) => void;
}) {
  return (
    <div className="markdown-message">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenLink(href);
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          // Model output must not trigger remote image requests on render.
          img: ({ alt }) => <span>{alt}</span>,
          table: ({ children }) => (
            <div className="markdown-table" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
