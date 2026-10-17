import { describe, expect, it } from 'vitest';
import { frequentSites, siteHost, siteLabel } from './frequent-sites';

describe('siteHost', () => {
  it('names a web page by its host, without www', () => {
    expect(siteHost('https://www.github.com/notifications')).toBe('github.com');
    expect(siteHost('http://news.ycombinator.com/')).toBe('news.ycombinator.com');
  });

  it('has no host for anything but a web page', () => {
    for (const url of ['chrome://settings', 'file:///Users/me/a.pdf', 'chrome-extension://abc/options.html', 'not a url']) {
      expect(siteHost(url)).toBeNull();
    }
  });
});

describe('siteLabel', () => {
  it('takes the part of the title that names the domain', () => {
    expect(siteLabel('Reddit - Dive into anything', 'reddit.com')).toBe('Reddit');
    expect(siteLabel('Feed | LinkedIn', 'linkedin.com')).toBe('LinkedIn');
    expect(siteLabel('Home / X', 'x.com')).toBe('X');
    expect(siteLabel('GitHub: Let’s build from here', 'github.com')).toBe('GitHub');
    expect(siteLabel('Stack Overflow - Where Developers Learn, Share, & Build Careers', 'stackoverflow.com')).toBe(
      'Stack Overflow',
    );
  });

  it('falls back to the last part, where most sites put their name', () => {
    expect(siteLabel('Inbox (3) - me@gmail.com - Gmail', 'mail.google.com')).toBe('Gmail');
  });

  it('drops an unread count in front of the title', () => {
    expect(siteLabel('(12) YouTube', 'youtube.com')).toBe('YouTube');
  });

  it('does not match a short domain inside an unrelated word', () => {
    expect(siteLabel('Explore / X', 'x.com')).toBe('X');
  });

  it('uses the host when the title is missing or too long to read', () => {
    expect(siteLabel(undefined, 'example.com')).toBe('example.com');
    expect(siteLabel('A very long page title that says nothing about the site', 'example.com')).toBe('example.com');
  });
});

describe('frequentSites', () => {
  const visited = [
    { url: 'https://github.com/notifications', title: 'Notifications · GitHub' },
    { url: 'https://github.com/pulls', title: 'Pull requests · GitHub' },
    { url: 'chrome://settings', title: 'Settings' },
    { url: 'https://www.youtube.com/', title: 'YouTube', favicon: 'data:image/png;base64,AAAA' },
    { url: 'https://example.com/', title: 'Example Domain' },
  ];

  it('keeps one tile per host, in the order the browser ranked them', () => {
    expect(frequentSites(visited, []).map((site) => site.host)).toEqual(['github.com', 'youtube.com', 'example.com']);
  });

  it('labels each tile and carries the icon the browser gave', () => {
    expect(frequentSites(visited, [])[1]).toEqual({
      url: 'https://www.youtube.com/',
      host: 'youtube.com',
      label: 'YouTube',
      icon: 'data:image/png;base64,AAAA',
    });
    expect(frequentSites(visited, [])[0]).not.toHaveProperty('icon');
  });

  it('leaves out the hosts the user hid', () => {
    expect(frequentSites(visited, ['youtube.com']).map((site) => site.host)).toEqual(['github.com', 'example.com']);
  });

  it('stops at the limit', () => {
    expect(frequentSites(visited, [], 2)).toHaveLength(2);
  });
});
