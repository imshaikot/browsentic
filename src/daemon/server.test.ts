import { rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, test } from 'vitest';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import type { ToolDescriptor } from '@/lib/actions/manifest';
import { describeActions } from '@/lib/actions/registry';
import { FOCUS_SHOT_ACTION, SAVE_SITE_MAP_ACTION } from '@/lib/actions/reserved';
import { toolNameFor } from '@/lib/actions/tool-names';
import { configPath } from './agent/config';
import type { Bridge, BridgeStatus } from './control';
import { FENCE_NOTE, IMAGE_NOTE } from './guardrails';
import { createMcpServer } from './server';

const KEY = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

type Answer = (action: string, input: unknown) => ActionResult;

/** A bridge that answers each action from a table, and remembers what it was asked. */
function fakeBridge(answers: Record<string, ActionResult> | Answer = {}, status: Partial<BridgeStatus> = {}, tools: ToolDescriptor[] = describeActions(), reserved?: string[]) {
  const asked: [string, unknown][] = [];
  const listeners: (() => void)[] = [];
  const answer: Answer = typeof answers === 'function' ? answers : (action) => answers[action] ?? failure('UNKNOWN_ACTION', action);
  const bridge: Bridge = {
    describe: async () => ({ tools, reserved }),
    invoke: async (action, input) => {
      asked.push([action, input]);
      return answer(action, input);
    },
    status: async () => ({
      connected: true,
      daemonVersion: '0.0.0-test',
      protocolVersion: 1,
      port: 0,
      manifestInSync: true,
      connectedBrowsers: 1,
      pairedBrowsers: 1,
      pairingPending: false,
      ...status,
    }),
    onManifestChanged: (listener) => listeners.push(listener),
    close: async () => {},
  };
  return { bridge, asked, changeManifest: () => listeners.forEach((listener) => listener()) };
}

async function connect(bridge: Bridge, opts: { agentRun?: boolean } = {}): Promise<Client> {
  const server = createMcpServer(bridge, '0.0.0-test', opts);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[] };

const texts = (result: Awaited<ReturnType<typeof call>>) => result.content.flatMap((part) => (part.type === 'text' ? [part.text ?? ''] : []));

afterEach(() => {
  rmSync(configPath, { force: true });
});

describe('the tool list', () => {
  test('mirrors the action registry, plus the status tool', async () => {
    const { tools } = await (await connect(fakeBridge().bridge)).listTools();
    expect(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).toEqual([
      ...describeActions().map((action) => ({ name: toolNameFor(action.name), description: action.description, inputSchema: action.inputSchema })),
      expect.objectContaining({ name: 'browsentic_status' }),
    ]);
  });

  test('a reserved tool is listed only when the daemon offers it to this caller', async () => {
    const offered = (reserved: string[]) => fakeBridge({}, {}, describeActions(), reserved).bridge;
    const names = async (bridge: Bridge) => (await (await connect(bridge, { agentRun: true })).listTools()).tools.slice(-2).map((tool) => tool.name);
    expect([await names(offered([FOCUS_SHOT_ACTION])), await names(offered([]))]).toEqual([
      ['browsentic_status', toolNameFor(FOCUS_SHOT_ACTION)],
      [toolNameFor(describeActions().at(-1)!.name), 'browsentic_status'],
    ]);
  });

  test('a daemon too old to say what it offers leaves an agent run with both reserved tools', async () => {
    const { tools } = await (await connect(fakeBridge().bridge, { agentRun: true })).listTools();
    expect(tools.slice(-3).map((tool) => tool.name)).toEqual(['browsentic_status', toolNameFor(SAVE_SITE_MAP_ACTION), toolNameFor(FOCUS_SHOT_ACTION)]);
  });

  test('an extension that describes an action no MCP client could call is refused, not passed on', async () => {
    const client = await connect(fakeBridge({}, {}, [{ name: 'page.read page', description: '', inputSchema: { type: 'object' } }]).bridge);
    await expect(client.listTools()).rejects.toThrow(/invalid MCP tool name/);
  });

  test('a manifest change reaches the client as a tool-list change', async () => {
    const { bridge, changeManifest } = fakeBridge();
    const client = await connect(bridge);
    const notified = new Promise<void>((resolve) => client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve()));
    changeManifest();
    await expect(notified).resolves.toBeUndefined();
  });
});

describe('a tool call', () => {
  test('is handed to the bridge as the action it names, with its arguments', async () => {
    const { bridge, asked } = fakeBridge({ 'page.clickElement': success({ clicked: true }) });
    await call(await connect(bridge), 'page_clickElement', { target: { text: 'Buy' } });
    expect(asked).toEqual([['page.clickElement', { target: { text: 'Buy' } }]]);
  });

  test('a page result comes back fenced as untrusted data, with any credential in it sealed', async () => {
    const client = await connect(fakeBridge({ 'page.extractText': success({ content: `Your API key is ${KEY}` }) }).bridge);
    const [body] = texts(await call(client, 'page_extractText'));
    expect({
      note: body.startsWith(FENCE_NOTE),
      opens: /<<<untrusted-page-data:[0-9a-f]+>>>/.test(body),
      closes: /<<<\/untrusted-page-data:[0-9a-f]+>>>/.test(body),
      leaks: body.includes('AbCdEfGhIj'),
      sealed: body.includes('⟦api-key:'),
    }).toEqual({ note: true, opens: true, closes: true, leaks: false, sealed: true });
  });

  test('an acknowledgement is not fenced, but is still sealed', async () => {
    const client = await connect(fakeBridge({ 'page.closeTab': success({ closed: KEY }) }).bridge);
    const [body] = texts(await call(client, 'page_closeTab'));
    expect([body.includes('untrusted-page-data'), body.includes('AbCdEfGhIj')]).toEqual([false, false]);
  });

  test('fencing can be turned off in config', async () => {
    writeFileSync(configPath, JSON.stringify({ guardrails: { fence: false } }));
    const client = await connect(fakeBridge({ 'page.extractText': success({ content: 'Pricing' }) }).bridge);
    expect(texts(await call(client, 'page_extractText'))).toEqual([JSON.stringify({ content: 'Pricing' })]);
  });

  test('a failure comes back as an error that reads CODE: message, unfenced', async () => {
    const client = await connect(fakeBridge({ 'page.clickElement': failure('TARGET_NOT_FOUND', 'No element matched "Buy".') }).bridge);
    expect(await call(client, 'page_clickElement')).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'TARGET_NOT_FOUND: No element matched "Buy".' }],
    });
  });
});

describe('a screenshot', () => {
  const shot = (data: Record<string, unknown>) => fakeBridge({ 'page.screenshot': success({ dataUrl: PNG, format: 'png', width: 1280, height: 800, ...data }) }).bridge;

  test('comes back as the image, with a note that what it shows is untrusted', async () => {
    const result = await call(await connect(shot({})), 'page_screenshot');
    expect(result.content).toEqual([
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      { type: 'text', text: `${IMAGE_NOTE} Captured 1280×800 png.` },
    ]);
  });

  test('a saved screenshot says where it is, so the agent can show it', async () => {
    const [note] = texts(await call(await connect(shot({ savedTo: '/Users/you/browsentic/screenshot/pricing.png' })), 'page_screenshot'));
    expect(note).toContain('Saved to /Users/you/browsentic/screenshot/pricing.png. Show this screenshot to the user');
  });

  test('a save that failed is reported alongside a capture that did not', async () => {
    const [note] = texts(await call(await connect(shot({ saveError: 'EACCES: permission denied', truncated: true })), 'page_screenshot'));
    expect([note.includes('Requested save failed: EACCES: permission denied.'), note.includes('the bottom is cut off')]).toEqual([true, true]);
  });

  test('a result with no image in it is shown as it is', async () => {
    const client = await connect(fakeBridge({ 'page.screenshot': success({ skipped: true }) }).bridge);
    expect(texts(await call(client, 'page_screenshot'))).toEqual([JSON.stringify({ skipped: true })]);
  });
});

describe('a picked element', () => {
  test('comes back fenced, with its photograph attached', async () => {
    const client = await connect(fakeBridge({ 'page.pickElement': success({ selector: 'button#buy', text: 'Buy now', shot: { dataUrl: PNG } }) }).bridge);
    const result = await call(client, 'page_pickElement');
    expect({
      fenced: result.content[0].text?.includes('untrusted-page-data'),
      carriesShot: result.content[0].text?.includes('dataUrl'),
      image: result.content[1],
      note: result.content[2].text,
    }).toEqual({
      fenced: true,
      carriesShot: false,
      image: { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      note: `${IMAGE_NOTE} This is the picked element photographed at the instant the user clicked it.`,
    });
  });

  test('without a photograph it is only the fenced result', async () => {
    const client = await connect(fakeBridge({ 'page.pickElement': success({ selector: 'button#buy' }) }).bridge);
    expect((await call(client, 'page_pickElement')).content).toHaveLength(1);
  });

  test("the element the user pointed at before the instruction comes back as its image", async () => {
    const client = await connect(fakeBridge({ [FOCUS_SHOT_ACTION]: success({ dataUrl: PNG }) }).bridge, { agentRun: true });
    expect((await call(client, toolNameFor(FOCUS_SHOT_ACTION))).content).toEqual([
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      { type: 'text', text: `${IMAGE_NOTE} This is the element the user pointed at with A-Eye, as it stood when they picked it.` },
    ]);
  });

  test('with no pick attached to the instruction, the focus shot is the failure it returned', async () => {
    const client = await connect(fakeBridge({ [FOCUS_SHOT_ACTION]: failure('NO_FOCUS', 'No element was picked.') }).bridge, { agentRun: true });
    expect(await call(client, toolNameFor(FOCUS_SHOT_ACTION))).toMatchObject({ isError: true });
  });
});

describe('the status tool', () => {
  const statusOf = async (answers: Record<string, ActionResult>, status: Partial<BridgeStatus> = {}) =>
    JSON.parse(texts(await call(await connect(fakeBridge(answers, status).bridge), 'browsentic_status'))[0]) as Record<string, unknown>;

  test('with no browser connected, it says to open one', async () => {
    expect(await statusOf({}, { connected: false })).toMatchObject({ connected: false, activeTab: null, hint: 'Open your browser with the Browsentic extension loaded.' });
  });

  test('with a browser connected, it names the active tab and any monitors running', async () => {
    const status = await statusOf({
      'page.getPageInfo': success({ document: { url: 'https://example.com/pricing', title: 'Pricing' }, layout: { diagram: '' } }),
      'page.monitorStatus': success({ monitors: [{ monitorId: 'm1', label: 'Export', host: 'example.com', phase: 'running', percent: 40, internal: 'x' }] }),
    });
    expect([status.activeTab, status.monitors, 'hint' in status]).toEqual([
      { url: 'https://example.com/pricing', title: 'Pricing' },
      [{ monitorId: 'm1', label: 'Export', host: 'example.com', phase: 'running', percent: 40 }],
      false,
    ]);
  });

  test('an extension older than the daemon, and a tab it cannot read, are both explained', async () => {
    const status = await statusOf({ 'page.getPageInfo': failure('TAB_UNREACHABLE', 'chrome:// page') }, { manifestInSync: false });
    expect({ activeTab: status.activeTab, stale: String(status.hint).includes('older build'), unreadable: String(status.hint).includes('Cannot read the active tab (TAB_UNREACHABLE)') }).toEqual({
      activeTab: null,
      stale: true,
      unreadable: true,
    });
  });
});

describe('resources', () => {
  const pageInfo = success({ document: { url: 'https://example.com', title: 'Example' }, layout: { diagram: '[header] [main] [footer]' } });

  test('three read-only views of the page are listed', async () => {
    const { resources } = await (await connect(fakeBridge().bridge)).listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(['browsentic://page/current', 'browsentic://page/diagram', 'browsentic://page/text']);
  });

  test("the page's text is read fenced and sealed", async () => {
    const client = await connect(fakeBridge({ 'page.extractText': success({ content: `token ${KEY}` }) }).bridge);
    const [{ text }] = (await client.readResource({ uri: 'browsentic://page/text' })).contents as { text: string }[];
    expect([text.includes('untrusted-page-data'), text.includes('AbCdEfGhIj')]).toEqual([true, false]);
  });

  test("the diagram is only the page's layout, and asks for as little as it can", async () => {
    const { bridge, asked } = fakeBridge({ 'page.getPageInfo': pageInfo });
    const [{ text }] = (await (await connect(bridge)).readResource({ uri: 'browsentic://page/diagram' })).contents as { text: string }[];
    expect([text.includes('[header] [main] [footer]'), text.includes('example.com'), asked]).toEqual([true, false, [['page.getPageInfo', { maxPerKind: 1 }]]]);
  });

  test('the snapshot is the whole page info', async () => {
    const [{ text }] = (await (await connect(fakeBridge({ 'page.getPageInfo': pageInfo }).bridge)).readResource({ uri: 'browsentic://page/current' }))
      .contents as { text: string }[];
    expect(text).toContain('"title": "Example"');
  });

  // Resources have no error result, so a failure has to be thrown to reach the client at all.
  test('a page that cannot be read throws, with the code and message', async () => {
    const client = await connect(fakeBridge({ 'page.getPageInfo': failure('TAB_UNREACHABLE', 'The active tab is a chrome:// page') }).bridge);
    await expect(client.readResource({ uri: 'browsentic://page/current' })).rejects.toThrow('TAB_UNREACHABLE: The active tab is a chrome:// page');
  });

  test('a resource that does not exist throws', async () => {
    await expect((await connect(fakeBridge().bridge)).readResource({ uri: 'browsentic://page/cookies' })).rejects.toThrow('Unknown resource');
  });
});
