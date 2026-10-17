import { describe, expect, it } from 'vitest';
import { suggestionsFor } from './suggestions';

describe('suggestionsFor', () => {
  it('offers general tasks to someone with no frequent sites yet', () => {
    expect(suggestionsFor([])).toEqual([
      'Find a flight to Lisbon next Friday and compare prices',
      'Compare the three best-reviewed noise-cancelling headphones',
      'Summarise the top stories on Hacker News',
    ]);
  });

  it('puts tasks on the sites visited most first, in visit order', () => {
    expect(suggestionsFor(['mail.google.com', 'example.com', 'github.com'])).toEqual([
      'Summarise my unread email',
      'List the pull requests waiting on my review',
      'Find a flight to Lisbon next Friday and compare prices',
    ]);
  });

  it('matches a site on its subdomains and country domains', () => {
    expect(suggestionsFor(['acme.atlassian.net'], 1)).toEqual(['List the Jira issues assigned to me']);
    expect(suggestionsFor(['amazon.co.uk'], 1)).toEqual(['Where is my latest Amazon order?']);
    expect(suggestionsFor(['app.slack.com'], 1)).toEqual(['Summarise my unread Slack messages']);
  });

  it('does not repeat a task a site and the general list share', () => {
    const offered = suggestionsFor(['news.ycombinator.com'], 4);
    expect(offered).toHaveLength(new Set(offered).size);
    expect(offered[0]).toBe('Summarise the top stories on Hacker News');
  });

  it('does not take a lookalike domain for the real one', () => {
    expect(suggestionsFor(['notgithub.com', 'amazon.example.com'], 1)).toEqual([
      'Find a flight to Lisbon next Friday and compare prices',
    ]);
  });
});
