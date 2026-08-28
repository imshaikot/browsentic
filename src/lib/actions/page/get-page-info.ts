import { z } from 'zod';
import { defineAction } from '../core';
import { accessibleText, cssPath, describeElement, documentBounds, isExposed } from './dom';

interface Tally {
  links: number;
  buttons: number;
  fields: number;
}

interface Region {
  role: string;
  label?: string;
  selector: string;
  bounds: { x: number; y: number; width: number; height: number };
  contains: Tally;
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
    'Snapshot the current page: document metadata, viewport and scroll state, a semantic layout tree with a text diagram, the heading outline, and an inventory of interactive elements — each carrying its ARIA role, its live state (disabled, checked, expanded, filled, aria-current) and the landmark region it sits in.',
  input: z.object({
    maxPerKind: z
      .number()
      .int()
      .positive()
      .default(30)
      .describe('Cap on links, buttons, fields, and forms listed per kind'),
  }),
  execute({ maxPerKind }) {
    const { regions, owners } = layoutTree();
    const found = collect();
    tally(found, owners);
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
        .filter(isExposed)
        .slice(0, 60)
        .map((heading) => ({
          level: Number(heading.tagName[1]),
          text: accessibleText(heading).slice(0, 120),
        })),
      interactive: inventory(found, owners, maxPerKind),
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

function layoutTree(): { regions: Region[]; owners: Map<HTMLElement, Region> } {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('header,nav,main,aside,footer,form,section,dialog,[role]'),
  ]
    .filter((el) => regionRole(el) && isExposed(el))
    .slice(0, 40);

  const regions: Region[] = [];
  const owners = new Map<HTMLElement, Region>();
  for (const el of candidates) {
    const region: Region = {
      role: regionRole(el)!,
      label: regionLabel(el),
      selector: cssPath(el),
      bounds: documentBounds(el),
      contains: { links: 0, buttons: 0, fields: 0 },
      children: [],
    };
    owners.set(el, region);
    let ancestor = el.parentElement;
    while (ancestor && !owners.has(ancestor)) ancestor = ancestor.parentElement;
    (ancestor ? owners.get(ancestor)!.children : regions).push(region);
  }
  return { regions, owners };
}

function regionName(region: Region): string {
  return region.label ? `${region.role} “${region.label}”` : region.role;
}

function ownerOf(el: HTMLElement, owners: Map<HTMLElement, Region>): Region | undefined {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const region = owners.get(node);
    if (region) return region;
  }
  return undefined;
}

function renderDiagram(regions: Region[]): string {
  const root = document.documentElement;
  const lines = [
    `page ${root.scrollWidth}×${root.scrollHeight} · viewport ${innerWidth}×${innerHeight} @ y=${Math.round(scrollY)}`,
  ];
  const walk = (nodes: Region[], indent: string) => {
    nodes.forEach((region, i) => {
      const last = i === nodes.length - 1;
      const { bounds, contains } = region;
      const counts = (['links', 'buttons', 'fields'] as const)
        .filter((kind) => contains[kind] > 0)
        .map((kind) => ` · ${contains[kind]} ${kind}`)
        .join('');
      lines.push(
        `${indent}${last ? '└' : '├'} ${regionName(region)} · ${bounds.width}×${bounds.height} @ (${bounds.x},${bounds.y})${counts}`,
      );
      walk(region.children, indent + (last ? '  ' : '│ '));
    });
  };
  walk(regions, '');
  return lines.join('\n');
}

function collect() {
  const exposed = <T extends HTMLElement>(selector: string) =>
    [...document.querySelectorAll<T>(selector)].filter(isExposed);
  return {
    links: exposed<HTMLAnchorElement>('a[href]'),
    buttons: exposed('button,[role="button"],input[type="button"],input[type="submit"]'),
    fields: exposed('input:not([type="hidden"]):not([type="button"]):not([type="submit"]),select,textarea'),
    forms: exposed<HTMLFormElement>('form'),
  };
}

function tally(found: ReturnType<typeof collect>, owners: Map<HTMLElement, Region>) {
  for (const kind of ['links', 'buttons', 'fields'] as const) {
    for (const el of found[kind]) {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const owner = owners.get(node);
        if (owner) owner.contains[kind] += 1;
      }
    }
  }
}

function inventory(
  found: ReturnType<typeof collect>,
  owners: Map<HTMLElement, Region>,
  cap: number,
) {
  const regionFor = (el: HTMLElement) => {
    const owner = ownerOf(el, owners);
    return owner && regionName(owner);
  };
  return {
    links: found.links.slice(0, cap).map((link) => ({
      ...describeElement(link),
      href: link.href,
      region: regionFor(link),
    })),
    buttons: found.buttons.slice(0, cap).map((button) => ({
      ...describeElement(button),
      region: regionFor(button),
    })),
    fields: found.fields.slice(0, cap).map((field) => ({
      ...describeElement(field),
      kind: field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase(),
      region: regionFor(field),
    })),
    forms: found.forms.slice(0, cap).map((form) => ({
      selector: cssPath(form),
      action: form.getAttribute('action') || undefined,
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      region: regionFor(form),
    })),
    counts: {
      links: found.links.length,
      buttons: found.buttons.length,
      fields: found.fields.length,
      forms: found.forms.length,
    },
  };
}
