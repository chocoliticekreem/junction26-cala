import type { ReactNode } from "react";

// Minimal, safe Markdown: headings, bullets, numbered lists, tables, paragraphs, **bold**,
// `code` and [links](https://…). Everything becomes React elements; no HTML is ever injected.

const SAFE_URL = /^https?:\/\//i;

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={i++}>{m[1]}</b>);
    else if (m[2]) out.push(<code key={i++}>{m[2]}</code>);
    else if (m[3]) {
      out.push(
        SAFE_URL.test(m[4]) ? (
          <a key={i++} href={m[4]} target="_blank" rel="noreferrer">
            {m[3]}
          </a>
        ) : (
          m[3]
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isRule = (l: string) => /^\s*\|?\s*:?-{2,}/.test(l);
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

// The three most useful short lines for a one-glance summary: bullet lines and table rows
// first, otherwise the first sentences.
export function markdownBullets(md: string, max = 3): string[] {
  const lines = md.split(/\r?\n/).map((l) => l.trim());
  const picks: string[] = [];
  for (const l of lines) {
    if (picks.length >= max) break;
    const bullet = l.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet) picks.push(bullet[1].replace(/\*\*/g, "").trim());
    else if (isRow(l) && !isRule(l)) {
      const c = cells(l).filter(Boolean);
      if (c.length >= 2 && !/^-+$/.test(c[1])) picks.push(c.join(": ").replace(/\*\*/g, ""));
    }
  }
  if (picks.length) return picks;
  const text = lines
    .filter((l) => l && !/^#/.test(l))
    .join(" ")
    .replace(/\*\*/g, "");
  return (text.match(/[^.!?]+[.!?]+/g) ?? [text])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      blocks.push(<h4 key={k++}>{inline(h[2])}</h4>);
      i++;
      continue;
    }
    if (isRow(l)) {
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i])) {
        if (!isRule(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <table key={k++}>
          {head && (
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, j) => (
                  <td key={j}>{inline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
    if (bullet.test(l)) {
      const items: string[] = [];
      const ordered = /^\s*\d+[.)]/.test(l);
      while (i < lines.length && bullet.test(lines[i])) {
        items.push(lines[i].replace(bullet, "").trim());
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !bullet.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(<p key={k++}>{inline(para.join(" "))}</p>);
  }
  return <div className="md">{blocks}</div>;
}
