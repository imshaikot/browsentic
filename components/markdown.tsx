import { useMemo, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {blocks.map((block, index) => renderBlock(block, String(index)))}
    </div>
  );
}

type Align = 'left' | 'center' | 'right';

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang?: string; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: string[]; align: Align[]; rows: string[][] }
  | { kind: 'rule' };

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[^\n]*$/;
const FENCE_LANG = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`~]*)/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})[.)])[ \t]+(.*)$/;
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;

const MAX_BLOCK_DEPTH = 12;

function parseBlocks(source: string, depth = 0): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (depth >= MAX_BLOCK_DEPTH) {
    const text = lines.filter((line) => line.trim()).join('\n');
    return text ? [{ kind: 'paragraph', text }] : [];
  }
  const blocks: Block[] = [];

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (FENCE_OPEN.test(line)) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)![1];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = FENCE_CLOSE.exec(lines[i]);
        if (close && close[1][0] === open[0] && close[1].length >= open.length) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'code', lang: FENCE_LANG.exec(line)?.[1] || undefined, text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (quoted.length > 0 && lines[i].trim()))) {
        quoted.push(lines[i].replace(QUOTE, ''));
        i++;
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted.join('\n'), depth + 1) });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const [list, next] = parseList(lines, i, item, depth);
      blocks.push(list);
      i = next;
      continue;
    }

    if (startsTable(lines, i)) {
      const [table, next] = parseTable(lines, i);
      blocks.push(table);
      i = next;
      continue;
    }

    const text: string[] = [];
    while (i < lines.length && lines[i].trim() && !opensBlock(lines, i)) {
      text.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: 'paragraph', text: text.join('\n') });
  }

  return blocks;
}

function opensBlock(lines: string[], at: number): boolean {
  const line = lines[at];
  return (
    FENCE_OPEN.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    ITEM.test(line) ||
    startsTable(lines, at)
  );
}

function parseList(lines: string[], start: number, first: RegExpExecArray, depth: number): [Block, number] {
  const indent = leading(first[1]);
  const ordered = first[3] !== undefined;
  const items: string[][] = [];
  let i = start;

  while (i < lines.length) {
    const item = ITEM.exec(lines[i]);
    if (!item || (item[3] !== undefined) !== ordered) break;
    const at = leading(item[1]);
    if (at < indent || at > indent + 1) break;

    const body = [item[4]];
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const after = lines[i + 1] ?? '';
        if (!after.trim() || leading(after) <= indent) break;
        body.push('');
        i++;
        continue;
      }
      if (leading(line) <= indent) break;
      body.push(dedent(line, indent + 2));
      i++;
    }
    items.push(body);
  }

  const list: Block = {
    kind: 'list',
    ordered,
    start: ordered ? Number.parseInt(first[3], 10) : 1,
    items: items.map((body) => parseBlocks(body.join('\n'), depth + 1)),
  };
  return [list, i];
}

function startsTable(lines: string[], at: number): boolean {
  return lines[at].includes('|') && at + 1 < lines.length && TABLE_DELIM.test(lines[at + 1]);
}

function parseTable(lines: string[], start: number): [Block, number] {
  const head = splitRow(lines[start]);
  const align: Align[] = splitRow(lines[start + 1]).map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    return cell.endsWith(':') ? 'right' : 'left';
  });
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !opensBlock(lines, i)) {
    rows.push(splitRow(lines[i]));
    i++;
  }
  return [{ kind: 'table', head, align, rows }, i];
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') {
      cell += '|';
      i++;
      continue;
    }
    if (line[i] === '|') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += line[i];
  }
  cells.push(cell);
  if (!cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1]?.trim()) cells.pop();
  return cells.map((text) => text.trim());
}

function leading(line: string): number {
  const ws = /^[ \t]*/.exec(line)![0];
  return ws.length + (ws.match(/\t/g)?.length ?? 0);
}

const dedent = (line: string, by: number) => line.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '  ').slice(by));

const CHIP = 'rounded bg-black/8 px-1 py-px font-mono text-[0.85em] dark:bg-white/12';

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
      return (
        <Tag key={key} className={cn('wrap-anywhere font-semibold', block.level <= 2 && 'text-[0.95rem]')}>
          {renderInline(block.text)}
        </Tag>
      );
    }

    case 'paragraph':
      return (
        <p key={key} className="wrap-anywhere">
          {renderInline(block.text)}
        </p>
      );

    case 'code':
      return (
        <pre
          key={key}
          className="max-w-full overflow-x-auto rounded-md bg-black/8 p-2 text-xs whitespace-pre dark:bg-white/12"
        >
          <code className="font-mono">{block.text}</code>
        </pre>
      );

    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index} className="wrap-anywhere">
          {renderItem(item)}
        </li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      );
    }

    case 'quote':
      return (
        <blockquote
          key={key}
          className="flex flex-col gap-2 border-l-2 border-black/15 pl-2.5 opacity-80 dark:border-white/20"
        >
          {block.blocks.map((inner, index) => renderBlock(inner, String(index)))}
        </blockquote>
      );

    case 'table':
      return (
        <div key={key} className="max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th
                    key={index}
                    className={cn('border-b border-black/15 px-1.5 py-1 font-semibold dark:border-white/20', ALIGN[block.align[index] ?? 'left'])}
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className={cn('border-b border-black/8 px-1.5 py-1 align-top dark:border-white/10', ALIGN[block.align[index] ?? 'left'])}
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'rule':
      return <hr key={key} className="border-black/10 dark:border-white/15" />;
  }
}

const ALIGN: Record<Align, string> = { left: 'text-left', center: 'text-center', right: 'text-right' };

function renderItem(blocks: Block[]): ReactNode {
  if (blocks.length === 1 && blocks[0].kind === 'paragraph') return renderInline(blocks[0].text);
  return <div className="flex flex-col gap-1.5">{blocks.map((block, index) => renderBlock(block, String(index)))}</div>;
}

const MAX_DEPTH = 4;
const MARKERS = '`*_~[!<h';
const ESCAPABLE = /[\\`*_~[\]()#+\-.!>|]/;

interface InlineRule {
  re: RegExp;
  linking?: true;
  node: (match: RegExpExecArray, key: string, depth: number, inLink: boolean) => ReactNode;
}

const MAX_LABEL = 512;
const MAX_HREF = 2048;
const MAX_LINK_SPAN = MAX_LABEL * 2 + MAX_HREF + 8;

const INLINE: InlineRule[] = [
  { re: /(`+)([^`]+?)\1(?!`)/y, node: (m, key) => <code key={key} className={CHIP}>{m[2]}</code> },
  { re: /\*\*(?!\s)([^\n]+?)\*\*/y, node: (m, key, d, inLink) => <strong key={key}>{renderInline(m[1], d + 1, inLink)}</strong> },
  { re: /__(?!\s)([^\n]+?)__/y, node: (m, key, d, inLink) => <strong key={key}>{renderInline(m[1], d + 1, inLink)}</strong> },
  { re: /~~(?!\s)([^\n]+?)~~/y, node: (m, key, d, inLink) => <del key={key}>{renderInline(m[1], d + 1, inLink)}</del> },
  { re: /\*(?!\s)([^*\n]+?)\*/y, node: (m, key, d, inLink) => <em key={key}>{renderInline(m[1], d + 1, inLink)}</em> },
  { re: /(?<![\w\\])_(?!\s)([^_\n]+?)_(?!\w)/y, node: (m, key, d, inLink) => <em key={key}>{renderInline(m[1], d + 1, inLink)}</em> },
  {
    re: new RegExp(`!\\[([^\\]\\n]{0,${MAX_LABEL}})\\]\\([ \\t]*([^)\\s]{0,${MAX_HREF}})[^)\\n]{0,${MAX_LABEL}}\\)`, 'y'),
    linking: true,
    node: (m, key, depth) => link(m[2], m[1] || m[2], key, depth),
  },
  {
    re: new RegExp(`\\[([^\\]\\n]{0,${MAX_LABEL}})\\]\\([ \\t]*([^)\\s]{0,${MAX_HREF}})[^)\\n]{0,${MAX_LABEL}}\\)`, 'y'),
    linking: true,
    node: (m, key, depth) => link(m[2], m[1], key, depth),
  },
  { re: /<(https?:\/\/[^>\s]+)>/y, linking: true, node: (m, key, depth) => link(m[1], m[1], key, depth) },
  { re: /https?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}]/y, linking: true, node: (m, key, depth) => link(m[0], m[0], key, depth) },
];

function renderInline(text: string, depth = 0, inLink = false): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  let pos = 0;
  const flush = () => {
    if (plain) out.push(plain);
    plain = '';
  };
  let closeAt = text.indexOf(')');

  while (pos < text.length) {
    const char = text[pos];

    if (char === '\\' && pos + 1 < text.length && ESCAPABLE.test(text[pos + 1])) {
      plain += text[pos + 1];
      pos += 2;
      continue;
    }
    if (char === '\n') {
      flush();
      out.push(<br key={`br${pos}`} />);
      pos++;
      continue;
    }

    if (char === '[' || char === '!') {
      if (closeAt !== -1 && closeAt < pos) closeAt = text.indexOf(')', pos);
      if (closeAt === -1 || closeAt - pos > MAX_LINK_SPAN) {
        plain += char;
        pos++;
        continue;
      }
    }

    let matched = false;
    if (depth < MAX_DEPTH && MARKERS.includes(char)) {
      for (const rule of INLINE) {
        if (inLink && rule.linking) continue;
        rule.re.lastIndex = pos;
        const match = rule.re.exec(text);
        const next = rule.re.lastIndex;
        if (!match || next <= pos) continue;
        flush();
        out.push(rule.node(match, `n${pos}`, depth, inLink));
        pos = next;
        matched = true;
        break;
      }
    }
    if (!matched) {
      plain += char;
      pos++;
    }
  }

  flush();
  return out;
}

function link(href: string, label: string, key: string, depth: number): ReactNode {
  const target = safeHref(href);
  const text = renderInline(label, depth + 1, true);
  if (!target) return <span key={key}>{text}</span>;
  return (
    <a
      key={key}
      href={target}
      target="_blank"
      rel="noreferrer noopener"
      className="underline decoration-1 underline-offset-2 hover:opacity-80"
    >
      {text}
    </a>
  );
}

function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}
