import { z } from 'zod';
import { defineAction } from '../core';
import { accessibleText, cssPath, describeElement, documentBounds, isVisible } from './dom';

interface Region {
  role: string;
  label?: string;
  selector: string;
  bounds: { x: number; y: number; width: number; height: number };
  children: Region[];
}

const IMPLICIT_ROLES: Record<string, string> = {
  header: 'banner',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  footer: 'contentinfo',
  form: 'form',
  section: 'section',
  dialog: 'dialog',
};

const LANDMARK_ROLES = new Set([
  'banner',
  'navigation',
  'main',
  'complementary',
  'contentinfo',
  'search',
  'form',
  'region',
  'dialog',
]);

export const getPageInfo = defineAction({
  name: 'page.getPageInfo',
  description:
    'Snapshot the current page: document metadata, viewport and scroll state, a semantic layout tree with a text diagram, the heading outline, and an inventory of interactive elements.',
  input: z.object({
    maxPerKind: z
      .number()
      .int()
      .positive()
      .default(30)
      .describe('Cap on links, buttons, fields, and forms listed per kind'),
  }),
  execute({ maxPerKind }) {
    const regions = layoutTree();
    return {
      document: {
        url: location.href,
        title: document.title,
        description:
          document.querySelector('meta[name="description"]')?.getAttribute('content') ?? undefined,
        lang: document.documentElement.lang || undefined,
      },
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollX: Math.round(scrollX),
        scrollY: Math.round(scrollY),
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
      },
      selection: getSelection()?.toString().slice(0, 500) || undefined,
      layout: { regions, diagram: renderDiagram(regions) },
      outline: [...document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')]
        .filter(isVisible)
        .slice(0, 60)
        .map((heading) => ({
          level: Number(heading.tagName[1]),
          text: accessibleText(heading).slice(0, 120),
        })),
      interactive: inventory(maxPerKind),
    };
  },
});

function regionRole(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return LANDMARK_ROLES.has(explicit) ? explicit : undefined;
  return IMPLICIT_ROLES[el.tagName.toLowerCase()];
}

function regionLabel(el: HTMLElement): string | undefined {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria.slice(0, 60);
  const labelledBy = el.getAttribute('aria-labelledby')?.split(/\s+/)[0];
  const heading =
    (labelledBy ? document.getElementById(labelledBy) : null) ??
    el.querySelector('h1,h2,h3,h4,h5,h6');
  return heading?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) || undefined;
}

function layoutTree(): Region[] {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('header,nav,main,aside,footer,form,section,dialog,[role]'),
  ]
    .filter((el) => regionRole(el) && isVisible(el))
    .slice(0, 40);

  const roots: Region[] = [];
  const known = new Map<HTMLElement, Region>();
  for (const el of candidates) {
    const region: Region = {
      role: regionRole(el)!,
      label: regionLabel(el),
      selector: cssPath(el),
      bounds: documentBounds(el),
      children: [],
    };
    known.set(el, region);
    let ancestor = el.parentElement;
    while (ancestor && !known.has(ancestor)) ancestor = ancestor.parentElement;
    (ancestor ? known.get(ancestor)!.children : roots).push(region);
  }
  return roots;
}

function renderDiagram(regions: Region[]): string {
  const root = document.documentElement;
  const lines = [
    `page ${root.scrollWidth}×${root.scrollHeight} · viewport ${innerWidth}×${innerHeight} @ y=${Math.round(scrollY)}`,
  ];
  const walk = (nodes: Region[], indent: string) => {
    nodes.forEach((region, i) => {
      const last = i === nodes.length - 1;
      const { role, label, bounds } = region;
      lines.push(
        `${indent}${last ? '└' : '├'} ${role}${label ? ` “${label}”` : ''} · ${bounds.width}×${bounds.height} @ (${bounds.x},${bounds.y})`,
      );
      walk(region.children, indent + (last ? '  ' : '│ '));
    });
  };
  walk(regions, '');
  return lines.join('\n');
}

function inventory(cap: number) {
  const visible = (selector: string) =>
    [...document.querySelectorAll<HTMLElement>(selector)].filter(isVisible);
  return {
    links: visible('a[href]')
      .slice(0, cap)
      .map((link) => ({
        text: accessibleText(link).slice(0, 80),
        href: (link as HTMLAnchorElement).href,
        selector: cssPath(link),
      })),
    buttons: visible('button,[role="button"],input[type="button"],input[type="submit"]')
      .slice(0, cap)
      .map(describeElement),
    fields: visible('input:not([type="hidden"]):not([type="button"]):not([type="submit"]),select,textarea')
      .slice(0, cap)
      .map((field) => ({
        ...describeElement(field),
        kind: field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase(),
      })),
    forms: visible('form')
      .slice(0, cap)
      .map((form) => ({
        selector: cssPath(form),
        action: form.getAttribute('action') || undefined,
        method: (form.getAttribute('method') || 'get').toLowerCase(),
      })),
  };
}
