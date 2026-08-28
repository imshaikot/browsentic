import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { cssPath, resolveTarget, targetSchema, type Target } from './dom';
import { typeInto } from './fill-input';
import {
  bestSearchField,
  describeField,
  fieldFor,
  searchFields,
  searchToggles,
  searchUrl,
  type SearchField,
} from './search';

const MAX_QUERY = 200;

export const searchSite = defineAction({
  name: 'page.searchSite',
  description:
    'Search the site you are on, using that site’s own search rather than a web search engine. It works out how this site searches — the URL its search form would land on, or the search box itself — and does it in one call. ' +
    'Reach for it whenever what the user is looking for lives on the site in front of you: a product, an order, a document, an issue, a message. A web search is for things this site does not know about. ' +
    'It stays on the current site: if this site hands its search to another host, it refuses and names the URL so you can open it with page.navigate. ' +
    'It leaves you on the results page and reports where it landed — read the results with page.getPageInfo or page.extractText afterwards, and act on them with the ordinary tools.',
  input: z.object({
    query: z.string().min(1).max(MAX_QUERY).describe('What to look for on this site'),
    strategy: z
      .enum(['auto', 'url', 'field'])
      .default('auto')
      .describe(
        'How to search: "auto" goes straight to the site’s search URL when one can be worked out and types into the box otherwise, ' +
          '"url" insists on the URL, "field" insists on typing — which is what a search box that filters as you type needs',
      ),
    target: targetSchema
      .optional()
      .describe('The search box to use, when the page has several or the one picked was wrong'),
  }),
  execute({ query, strategy, target }) {
    const field = chooseField(target);
    const built = strategy === 'field' ? null : searchUrl(field, query);

    if (built) {
      if (built.url.origin !== location.origin) throw offSite(built.url.href);
      location.assign(built.url.href);
      return {
        searchedFor: query,
        via: 'url',
        templateFrom: built.from,
        navigatingTo: built.url.href,
        field: field ? describeField(field) : undefined,
      };
    }

    if (strategy === 'url') {
      throw new ActionError(
        'No search URL could be worked out here — this site’s search is not a GET form and the address carries no query parameter. Try strategy "field".',
        'TARGET_NOT_FOUND',
      );
    }
    return typeIntoField(field, query);
  },
});

function chooseField(target?: Target): SearchField | null {
  if (target) return fieldFor(resolveTarget(target, { includeHidden: true }));
  return bestSearchField(searchFields());
}

function typeIntoField(field: SearchField | null, query: string) {
  if (!field) {
    throw new ActionError(
      'No search box on this page. Call page.findSearch to see what search this site does have, if any.',
      'TARGET_NOT_FOUND',
    );
  }
  if (field.hidden) {
    throw new ActionError(`The search box on this page is hidden${revealHint()}.`, 'TARGET_NOT_FOUND');
  }
  const action = field.form?.getAttribute('action');
  const posted = action && new URL(action, location.href);
  if (posted && posted.origin !== location.origin) throw offSite(posted.href);

  field.element.focus();
  const { submitted } = typeInto(field.element, query, { clear: true, pressEnter: true });
  return { searchedFor: query, via: 'field', submitted, field: describeField(field) };
}

function revealHint(): string {
  const toggle = searchToggles(searchFields())[0];
  return toggle
    ? ` — click ${cssPath(toggle)} to reveal it, then search again`
    : ', and nothing on the page reveals it';
}

function offSite(href: string): ActionError {
  return new ActionError(
    `This site hands its search to another host. Open ${href} with page.navigate instead, so it goes through the usual checks.`,
    'UNSUPPORTED',
  );
}
