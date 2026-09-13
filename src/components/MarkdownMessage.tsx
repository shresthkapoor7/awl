import { useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.css";

export function MarkdownMessage({
  text,
  onOpenLink,
}: {
  text: string;
  onOpenLink: (url: string) => Promise<void>;
}) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const latestLink = useRef(0);
  async function openLink(url: string) {
    const request = ++latestLink.current;
    setLinkError(null);
    try {
      await onOpenLink(url);
    } catch (error) {
      if (request === latestLink.current)
        setLinkError(
          error instanceof Error
            ? error.message
            : "Could not open the link. Try again.",
        );
    }
  }
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
                  void openLink(href);
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
      {linkError && (
        <p className="live-agent-error" role="alert">
          {linkError}
        </p>
      )}
    </div>
  );
}
