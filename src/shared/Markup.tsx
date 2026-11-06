import { Fragment, type ReactNode } from "react";

/**
 * The little markup survey text may use: blank line = new paragraph, **bold**,
 * [link text](https://…) and bare https:// links. Everything else is plain text
 * (no HTML), so a survey file can never inject markup into the page.
 */
export function Markup({ text, className }: { text?: string; className?: string }) {
  if (!text?.trim()) return null;
  const paras = text.trim().split(/\n\s*\n/);
  return (
    <div className={className ? `markup ${className}` : "markup"}>
      {paras.map((p, i) => (
        <p key={i}>{inline(p)}</p>
      ))}
    </div>
  );
}

const TOKEN = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+[^\s).,;:])/g;

function inline(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  const lines = (s: string) =>
    s.split("\n").map((line, i) => (
      <Fragment key={`t${k++}`}>
        {i > 0 && <br />}
        {line}
      </Fragment>
    ));
  for (const m of src.matchAll(TOKEN)) {
    out.push(...lines(src.slice(last, m.index)));
    if (m[1] !== undefined) out.push(<strong key={`b${k++}`}>{m[1]}</strong>);
    else {
      const href = m[3] ?? m[4];
      out.push(
        <a key={`a${k++}`} href={href} target="_blank" rel="noopener noreferrer">
          {m[2] ?? m[4]}
        </a>,
      );
    }
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(...lines(src.slice(last)));
  return out;
}
