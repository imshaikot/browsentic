interface SiteTask {
  site: RegExp;
  text: string;
}

const SITE_TASKS: readonly SiteTask[] = [
  { site: /(^|\.)github\.com$/, text: 'List the pull requests waiting on my review' },
  { site: /^(mail\.google\.com|outlook\.(live|office|office365)\.com)$/, text: 'Summarise my unread email' },
  { site: /^calendar\.google\.com$/, text: 'What is on my calendar tomorrow?' },
  { site: /^news\.ycombinator\.com$/, text: 'Summarise the top stories on Hacker News' },
  { site: /(^|\.)linkedin\.com$/, text: 'Show my unread LinkedIn messages' },
  { site: /(^|\.)youtube\.com$/, text: 'List the new videos from my YouTube subscriptions' },
  { site: /(^|\.)reddit\.com$/, text: 'Summarise the top posts on my Reddit front page' },
  { site: /^(x|twitter)\.com$/, text: 'Summarise my notifications on X' },
  { site: /\.atlassian\.net$/, text: 'List the Jira issues assigned to me' },
  { site: /(^|\.)slack\.com$/, text: 'Summarise my unread Slack messages' },
  { site: /(^|\.)amazon\.(com|ca|de|fr|in|it|es|nl|se|pl|com\.au|com\.br|com\.mx|co\.uk|co\.jp)$/, text: 'Where is my latest Amazon order?' },
  { site: /^docs\.google\.com$/, text: 'Open the Google Doc I edited last' },
];

const ANYWHERE = [
  'Find a flight to Lisbon next Friday and compare prices',
  'Compare the three best-reviewed noise-cancelling headphones',
  'Summarise the top stories on Hacker News',
];

/** Tasks on the sites the user visits most come first, in the order they visit them; general ones fill the rest. */
export function suggestionsFor(hosts: readonly string[], count = 3): string[] {
  const personal = hosts.flatMap((host) => SITE_TASKS.filter(({ site }) => site.test(host)).map(({ text }) => text));
  return [...new Set([...personal, ...ANYWHERE])].slice(0, count);
}
