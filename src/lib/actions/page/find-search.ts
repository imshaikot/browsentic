import { z } from 'zod';
import { defineAction } from '../core';
import { describeElement } from './dom';
import {
  bestSearchField,
  describeField,
  openSearchLink,
  searchFields,
  searchLinks,
  searchTemplate,
  searchToggles,
} from './search';

export const findSearch = defineAction({
  name: 'page.findSearch',
  description:
    'Report how this site can be searched from where you are: the search boxes on the page — including one hidden behind a header toggle — the buttons that reveal them, links to a search page, and the URL template a search would land on, with {query} where the words go. ' +
    'Read-only: it never types and never navigates. Call it to find out whether searching this site is possible at all before offering to, or to record a site’s search entry point while mapping it. ' +
    'An empty result with searchable false means this site has no search of its own — say so rather than typing into some other field.',
  input: z.object({
    maxPerKind: z
      .number()
      .int()
      .positive()
      .max(20)
      .default(5)
      .describe('Cap on search boxes, toggles and links listed per kind, most likely first'),
  }),
  execute({ maxPerKind }) {
    const fields = searchFields();
    const template = searchTemplate(bestSearchField(fields));
    return {
      url: location.href,
      searchable: fields.length > 0 || !!template,
      ...(template ?? {}),
      fields: fields.slice(0, maxPerKind).map(describeField),
      toggles: searchToggles(fields).slice(0, maxPerKind).map(describeElement),
      links: searchLinks()
        .slice(0, maxPerKind)
        .map((link) => ({ ...describeElement(link), href: link.href })),
      openSearch: openSearchLink(),
    };
  },
});
