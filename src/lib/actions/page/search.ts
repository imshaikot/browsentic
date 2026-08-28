import { ActionError } from '../core';
import { accessibleText, cssPath, describeElement, isVisible, submitsOnClick } from './dom';

const QUERY_TOKEN = '{query}';

const SEARCH_PARAMS = ['q', 'query', 'k', 's', 'search', 'keyword', 'keywords', 'term', 'wd', 'text'];

const SEARCH_WORD = /\b(?:search|zoek|suche|suchen|recherche|buscar|cerca|szukaj)/i;

const NAMING_ATTRIBUTES = ['name', 'id', 'class', 'aria-label', 'placeholder', 'title'];

const TEXT_ENTRY_TYPES = new Set(['search', 'text', '']);

const CANDIDATES: { selector: string; named: boolean }[] = [
  { selector: 'input[type="search"], [role="searchbox"]', named: false },
  { selector: '[role="search"] input, form[role="search"] input, form[action*="search" i] input', named: false },
  { selector: 'input[type="text"], input:not([type])', named: true },
];

export interface SearchField {
  element: HTMLElement;
  form: HTMLFormElement | null;
  param: string;
  hidden: boolean;
}

export type TemplateSource = 'form' | 'address';

export function searchFields(): SearchField[] {
  const found = new Set<HTMLElement>();
  for (const { selector, named } of CANDIDATES) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (!isTextEntry(element) || barred(element)) continue;
      if (named && !namedForSearch(element)) continue;
      found.add(element);
    }
  }
  return [...found].map(toField);
}

export function bestSearchField(fields: readonly SearchField[]): SearchField | null {
  return fields.find((field) => !field.hidden) ?? fields[0] ?? null;
}

export function fieldFor(element: HTMLElement): SearchField {
  if (!isTextEntry(element)) {
    throw new ActionError(`<${element.tagName.toLowerCase()}> is not a text field to search in`, 'INVALID_TARGET');
  }
  if (barred(element)) {
    throw new ActionError(
      'That field is disabled, or sits in a form with a password in it — a sign-in form is not a search box',
      'INVALID_TARGET',
    );
  }
  return toField(element);
}

export function searchToggles(fields: readonly SearchField[]): HTMLElement[] {
  const shown = fields.filter((field) => !field.hidden).map(({ element }) => element);
  return [...document.querySelectorAll<HTMLElement>('button,[role="button"],summary,a[href]')]
    .filter(isVisible)
    .filter((element) => SEARCH_WORD.test(labelOf(element)))
    .filter((element) => !submitsOnClick(element))
    .filter((element) => !shown.some((field) => element.contains(field)));
}

export function searchLinks(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .filter(isVisible)
    .filter(leadsToSearch);
}

export function openSearchLink(): { href: string; title?: string } | undefined {
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel~="search"][type="application/opensearchdescription+xml"]',
  );
  return link ? { href: link.href, title: link.title || undefined } : undefined;
}

export function searchUrl(
  field: SearchField | null,
  value: string,
): { url: URL; from: TemplateSource } | null {
  const fromForm = field && formUrl(field, value);
  if (fromForm) return { url: fromForm, from: 'form' };
  const fromAddress = addressUrl(value);
  return fromAddress ? { url: fromAddress, from: 'address' } : null;
}

export function searchTemplate(
  field: SearchField | null,
): { template: string; templateFrom: TemplateSource } | null {
  const built = searchUrl(field, QUERY_TOKEN);
  if (!built) return null;
  return {
    template: built.url.href.replace(encodeURIComponent(QUERY_TOKEN), QUERY_TOKEN),
    templateFrom: built.from,
  };
}

export function describeField({ element, form, param, hidden }: SearchField) {
  return {
    ...describeElement(element),
    param: param || undefined,
    hidden: hidden || undefined,
    form: form
      ? {
          selector: cssPath(form),
          action: form.getAttribute('action') || undefined,
          method: (form.getAttribute('method') || 'get').toLowerCase(),
        }
      : undefined,
  };
}

function toField(element: HTMLElement): SearchField {
  return {
    element,
    form: element.closest('form'),
    param: element.getAttribute('name')?.trim() ?? '',
    hidden: !isVisible(element),
  };
}

function isTextEntry(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) return TEXT_ENTRY_TYPES.has(element.type);
  return element.isContentEditable;
}

function barred(element: HTMLElement): boolean {
  if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return true;
  return !!element.closest('form')?.querySelector('input[type="password"]');
}

function namedForSearch(element: HTMLElement): boolean {
  const name = element.getAttribute('name')?.trim().toLowerCase() ?? '';
  if (SEARCH_PARAMS.includes(name)) return true;
  return SEARCH_WORD.test(labelOf(element));
}

function labelOf(element: HTMLElement): string {
  const attributes = NAMING_ATTRIBUTES.map((attribute) => element.getAttribute(attribute) ?? '');
  return [...attributes, accessibleText(element)].join(' ');
}

function leadsToSearch(link: HTMLAnchorElement): boolean {
  try {
    const url = new URL(link.href);
    return url.origin === location.origin && SEARCH_WORD.test(url.pathname);
  } catch {
    return false;
  }
}

function formUrl({ form, param }: SearchField, value: string): URL | null {
  if (!form || !param) return null;
  if ((form.getAttribute('method') || 'get').toLowerCase() !== 'get') return null;
  const url = new URL(form.getAttribute('action') || location.href, location.href);
  const params = new URLSearchParams();
  for (const [name, entry] of new FormData(form)) {
    if (typeof entry === 'string') params.set(name, entry);
  }
  params.set(param, value);
  url.search = params.toString();
  url.hash = '';
  return url;
}

function addressUrl(value: string): URL | null {
  const url = new URL(location.href);
  const param = [...url.searchParams.keys()].find((key) => SEARCH_PARAMS.includes(key.toLowerCase()));
  if (!param) return null;
  url.searchParams.set(param, value);
  url.hash = '';
  return url;
}
