import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import type { Bridge, BridgeStatus, Described } from './control';
import { FENCE_NOTE, IMAGE_NOTE, INJECT_ACTION, policyFrom } from './guardrails';
import { stateDir } from './lockfile';
import { grouped } from './tool-groups';
import { createMcpServer } from './server';
import { toolHost } from './tool-host';

const KEY = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const GROUPED = describeActions()
  .filter((action) => grouped(action.name))
  .map((action) => action.name);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

type Answer = (action: string, input: unknown) => ActionResult;

/** A bridge that answers each action from a table, and remembers what it was asked. */
function fakeBridge(
  answers: Record<string, ActionResult> | Answer = {},
  status: Partial<BridgeStatus> = {},
  tools: ToolDescriptor[] = describeActions(),
  offer: Omit<Described, 'tools'> = {},
) {
  const asked: [string, unknown][] = [];
  const listeners: (() => void)[] = [];
  const answer: Answer = typeof answers === 'function' ? answers : (action) => answers[action] ?? failure('UNKNOWN_ACTION', action);
  const bridge: Bridge = {
    describe: async () => ({ tools, ...offer }),
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

async function connect(bridge: Bridge, opts: { agentRun?: boolean; resultBytes?: number } = {}): Promise<Client> {
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
  test('mirrors the action registry, plus the status tool and the guide opener', async () => {
    const { tools } = await (await connect(fakeBridge().bridge)).listTools();
    expect(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).toEqual([
      ...describeActions().map((action) => ({ name: toolNameFor(action.name), description: action.description, inputSchema: action.inputSchema })),
      expect.objectContaining({ name: 'browsentic_status' }),
      expect.objectContaining({ name: 'browsentic_openSkill' }),
    ]);
  });

  test('the guide opener names every guide, in the words of the need, with a schema that takes only those names', async () => {
    const { tools } = await (await connect(fakeBridge().bridge)).listTools();
    const opener = tools.find((tool) => tool.name === 'browsentic_openSkill')!;
    expect({
      lines: opener.description!.split('\n').slice(1).map((line) => line.split(':')[0]),
      captcha: opener.description!.includes('- captcha: get past a “verify you are human” check'),
      names: (opener.inputSchema.properties as { name: { enum: string[] } }).name.enum,
    }).toEqual({
      lines: ['- captcha', '- theming', '- diagnostics', '- monitoring', '- downloads', '- drag'],
      captcha: true,
      names: ['captcha', 'theming', 'diagnostics', 'monitoring', 'downloads', 'drag'],
    });
  });

  test('the server instructions carry the same index, well inside what a client keeps of them', async () => {
    const instructions = (await connect(fakeBridge().bridge)).getInstructions() ?? '';
    expect({
      opener: instructions.includes('opened with browsentic_openSkill'),
      chromium: instructions.includes('- diagnostics: read the console errors, exceptions and failed requests behind a page that misbehaves (Chromium browsers only)'),
      kept: instructions.length < 4_096,
    }).toEqual({ opener: true, chromium: true, kept: true });
  });

  test('a run that reaches the grouped tools on demand lists the rest, then the tool that runs those', async () => {
    const onDemand = GROUPED;
    const { tools } = await (await connect(fakeBridge({}, {}, describeActions(), { reserved: [], onDemand, delivery: 'on-demand' }).bridge, { agentRun: true })).listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      ...describeActions().filter((action) => !onDemand.includes(action.name)).map((action) => toolNameFor(action.name)),
      'browsentic_status',
      'browsentic_openSkill',
      'browsentic_use',
    ]);
  });

  test('a namespaced run lists every tool to an MCP client, which takes no namespaces, and its guides say to call them by name', async () => {
    const offer = { reserved: [], onDemand: GROUPED, delivery: 'namespaced' as const };
    const client = await connect(fakeBridge({}, {}, describeActions(), offer).bridge, { agentRun: true });
    const { tools } = await client.listTools();
    const [guide] = texts(await call(client, 'browsentic_openSkill', { name: 'drag' }));
    expect([tools.length, tools.some((tool) => tool.name === 'browsentic_use'), guide.split('\n\n')[2]]).toEqual([
      describeActions().length + 2,
      false,
      'Call them by name, as you would any other tool.',
    ]);
  });

  test("a namespaced run hands a CLI that takes namespaces each group apart, named and described by its index line, for the CLI's own search", async () => {
    const offer = { reserved: [], onDemand: GROUPED, delivery: 'namespaced' as const };
    const host = toolHost(fakeBridge({}, {}, describeActions(), offer).bridge, { agentRun: true, namespaces: true, policy: policyFrom(undefined), tag: 'tag' });
    const { tools, groups } = await host.list();
    const [guide] = texts((await host.call('browsentic_openSkill', { name: 'captcha' })) as Awaited<ReturnType<typeof call>>);
    expect({
      listed: tools.map((tool) => tool.name).filter((name) => GROUPED.map(toolNameFor).includes(name) || name === 'browsentic_use'),
      groups: groups.map((group) => [group.description.split(':')[0], group.name, group.tools.map((tool) => tool.name)]),
      captcha: groups[0].description,
      guide: guide.split('\n\n').find((part) => part.startsWith('They load')),
    }).toEqual({
      listed: [],
      groups: [
        ['captcha', 'captcha', ['page_findCaptcha', 'page_solveCaptcha']],
        ['theming', 'theming', ['page_readTheme', 'page_auditContrast', 'page_applyTheme']],
        ['diagnostics', 'diagnostics', ['page_startDiagnostics', 'page_readConsole', 'page_readNetwork', 'page_stopDiagnostics']],
        [
          'monitoring',
          'monitoring',
          ['page_findProgress', 'page_startMonitor', 'page_monitorStatus', 'page_awaitMonitor', 'page_stopMonitor', 'page_startTimer', 'page_timerStatus', 'page_stopTimer'],
        ],
        ['downloads', 'downloads', ['page_captureDownload', 'page_listDownloads']],
        ['drag', 'drag', ['page_dragElement']],
      ],
      captcha: 'captcha: get past a “verify you are human” check: reCAPTCHA, hCaptcha, Turnstile',
      guide:
        'They load when you search for them: tool_search with "captcha" loads them all, then call each by name. Inside exec they are tools.captcha__<tool>, such as tools.captcha__page_findCaptcha.',
    });
  });

  test('a namespaced run keeps a grouped tool it withholds, as on the phone, in its own group, so exec names it alike on every turn', async () => {
    const off = ['page.findCaptcha', 'page.solveCaptcha', INJECT_ACTION];
    const all = describeActions();
    const offer = {
      reserved: [],
      withheld: all.filter((tool) => off.includes(tool.name)),
      onDemand: GROUPED.filter((name) => !off.includes(name)),
      delivery: 'namespaced' as const,
    };
    const bridge = fakeBridge({}, {}, all.filter((tool) => !off.includes(tool.name)), offer).bridge;
    const { withheld, groups } = await toolHost(bridge, { agentRun: true, namespaces: true, policy: policyFrom(undefined), tag: 'tag' }).list();
    expect({
      withheld: withheld.map((tool) => tool.name),
      captcha: groups.find((group) => group.name === 'captcha')?.tools.map((tool) => tool.name),
    }).toEqual({ withheld: [toolNameFor(INJECT_ACTION)], captcha: ['page_findCaptcha', 'page_solveCaptcha'] });
  });

  test('a reserved tool is listed only when the daemon offers it to this caller', async () => {
    const offered = (reserved: string[]) => fakeBridge({}, {}, describeActions(), { reserved }).bridge;
    const names = async (bridge: Bridge) => (await (await connect(bridge, { agentRun: true })).listTools()).tools.slice(-2).map((tool) => tool.name);
    expect([await names(offered([FOCUS_SHOT_ACTION])), await names(offered([]))]).toEqual([
      ['browsentic_openSkill', toolNameFor(FOCUS_SHOT_ACTION)],
      ['browsentic_status', 'browsentic_openSkill'],
    ]);
  });

  test('a daemon too old to say what it offers leaves an agent run with both reserved tools', async () => {
    const { tools } = await (await connect(fakeBridge().bridge, { agentRun: true })).listTools();
    expect(tools.slice(-4).map((tool) => tool.name)).toEqual([
      'browsentic_status',
      'browsentic_openSkill',
      toolNameFor(SAVE_SITE_MAP_ACTION),
      toolNameFor(FOCUS_SHOT_ACTION),
    ]);
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

describe('a result, for an agent CLI that keeps long ones from its model', () => {
  const LIMIT = 40_000;

  test('over the limit is refused whole, saying the call went through and how to ask for less', async () => {
    const client = await connect(fakeBridge({ 'page.getPageInfo': success({ links: 'x'.repeat(LIMIT) }) }).bridge, { resultBytes: LIMIT });
    const result = await call(client, 'page_getPageInfo');
    const [text] = texts(result);
    expect([result.isError, text.startsWith('RESULT_TOO_LARGE: The call went through'), text.includes('maxPerKind')]).toEqual([true, true, true]);
  });

  test('is counted in bytes, so text that fits in characters can still be over', async () => {
    const client = await connect(fakeBridge({ 'page.getPageInfo': success({ title: 'é'.repeat(LIMIT / 2) }) }).bridge, { resultBytes: LIMIT });
    expect((await call(client, 'page_getPageInfo')).isError).toBe(true);
  });

  test('within it comes back as is, and a picture beside it does not count', async () => {
    const big = `data:image/png;base64,${'A'.repeat(200_000)}`;
    const client = await connect(fakeBridge({ 'page.screenshot': success({ dataUrl: big, format: 'png', width: 1280, height: 800 }) }).bridge, { resultBytes: LIMIT });
    const result = await call(client, 'page_screenshot');
    expect([result.isError, result.content.map((part) => part.type)]).toEqual([undefined, ['image', 'text']]);
  });

  test('a long read is asked for a group that fits, and a short one as asked', async () => {
    const { bridge, asked } = fakeBridge({ 'page.extractText': success({ content: 'Pricing' }) });
    const client = await connect(bridge, { resultBytes: LIMIT });
    for (const args of [{}, { maxLength: 100_000 }, { maxLength: 500 }]) await call(client, 'page_extractText', args);
    expect(asked.map(([, input]) => (input as { maxLength?: number }).maxLength)).toEqual([10_000, 10_000, 500]);
  });

  test('with no limit, nothing is refused or narrowed', async () => {
    const { bridge, asked } = fakeBridge({ 'page.extractText': success({ content: 'x'.repeat(100_000) }) });
    const result = await call(await connect(bridge), 'page_extractText', { maxLength: 100_000 });
    expect([result.isError, asked]).toEqual([undefined, [['page.extractText', { maxLength: 100_000 }]]]);
  });
});

test('a call the client stops waiting for tells the bridge so', async () => {
  let given: AbortSignal | undefined;
  const { bridge } = fakeBridge();
  bridge.invoke = (_action, _input, signal) => {
    given = signal;
    return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(failure('CANCELLED', 'gone'))));
  };
  const client = await connect(bridge);
  const abandoned = new AbortController();
  const pending = client.callTool({ name: 'page_clickElement', arguments: {} }, undefined, { signal: abandoned.signal });
  await expect.poll(() => given).toBeDefined();
  abandoned.abort();
  await expect(pending).rejects.toThrow();
  await expect.poll(() => given?.aborted).toBe(true);
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

describe('an open captcha challenge', () => {
  test('comes back fenced, with the challenge attached as its picture', async () => {
    const client = await connect(
      fakeBridge({
        'page.solveCaptcha': success({
          state: 'challenge',
          challenge: { kind: 'tiles', prompt: 'Select all images with a bus', tiles: 9, image: PNG, imageWidth: 788, imageHeight: 788 },
        }),
      }).bridge,
    );
    const result = await call(client, 'page_solveCaptcha');
    expect({
      fenced: result.content[0].text?.includes('untrusted-page-data'),
      carriesImage: result.content[0].text?.includes('base64'),
      image: result.content[1],
      note: result.content[2].text,
    }).toEqual({
      fenced: true,
      carriesImage: false,
      image: { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      note: `${IMAGE_NOTE} This is the open captcha challenge, 788×788 pixels, each tile numbered in its corner.`,
    });
  });

  test('a solved captcha is only the result', async () => {
    const client = await connect(fakeBridge({ 'page.solveCaptcha': success({ state: 'solved', solved: true }) }).bridge);
    expect((await call(client, 'page_solveCaptcha')).content).toHaveLength(1);
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

describe('a guide', () => {
  const open = async (name: unknown, tools?: ToolDescriptor[]) => call(await connect(fakeBridge({}, {}, tools).bridge), 'browsentic_openSkill', { name });

  test("opens with its skill, then each of its tools with the description and schema it is listed with", async () => {
    const [text] = texts(await open('drag'));
    const drag = describeActions().find((action) => action.name === 'page.dragElement')!;
    expect(text).toBe(
      `# The drag guide\n\n## Its tools\n\nCall them by name, as you would any other tool.\n\n` +
        `### page_dragElement\n${drag.description}\nInput schema: ${JSON.stringify(drag.inputSchema)}`,
    );
  });

  test('tells a run that reaches its tools on demand to call them through browsentic_use', async () => {
    const onDemand = GROUPED;
    const client = await connect(fakeBridge({}, {}, describeActions(), { reserved: [], onDemand, delivery: 'on-demand' }).bridge);
    const [text] = texts(await call(client, 'browsentic_openSkill', { name: 'drag' }));
    expect(text.split('\n\n')[2]).toBe(
      'They are not in your tool list. Call each through browsentic_use, its name as action and its parameters as input: {"action": "page_dragElement", "input": {...}}.',
    );
  });

  test('monitoring teaches watching and timers, in that order, and lists all eight tools', async () => {
    const [text] = texts(await open('monitoring'));
    expect({
      order: text.indexOf('You are setting up a watch') < text.indexOf('The extension keeps the clock'),
      tools: [...text.matchAll(/^### (\S+)$/gm)].map((match) => match[1]),
    }).toEqual({
      order: true,
      tools: ['page_findProgress', 'page_startMonitor', 'page_monitorStatus', 'page_awaitMonitor', 'page_stopMonitor', 'page_startTimer', 'page_timerStatus', 'page_stopTimer'],
    });
  });

  test('a skill the user rewrote is the one the guide opens with', async () => {
    mkdirSync(join(stateDir, 'skills'), { recursive: true });
    writeFileSync(join(stateDir, 'skills', 'captcha.md'), '---\nname: captcha\ndescription: mine\n---\nAsk me before any captcha.\n');
    try {
      const [text] = texts(await open('captcha'));
      expect(text.startsWith('# The captcha guide\n\nAsk me before any captcha.\n\n## Its tools')).toBe(true);
    } finally {
      rmSync(join(stateDir, 'skills'), { recursive: true, force: true });
    }
  });

  test('opens by its skill or any of its tools as well as by its own name', async () => {
    const heading = async (name: string) => texts(await open(name))[0].split('\n')[0];
    expect(await Promise.all(['theming', 'page-theming', 'page_applyTheme', 'page.readTheme', 'auditContrast', 'scheduled-jobs'].map(heading))).toEqual([
      '# The theming guide',
      '# The theming guide',
      '# The theming guide',
      '# The theming guide',
      '# The theming guide',
      '# The monitoring guide',
    ]);
  });

  test('names what this run is not offered, and refuses a guide with nothing to offer', async () => {
    const phone = describeActions().filter((action) => ['page.findProgress', 'page.startTimer', 'page.timerStatus', 'page.stopTimer'].includes(action.name));
    const monitoring = await open('monitoring', phone);
    const firefox = await open('captcha', describeActions('firefox'));
    expect({
      offered: [...texts(monitoring)[0].matchAll(/^### (\S+)$/gm)].map((match) => match[1]),
      missing: texts(monitoring)[0].endsWith('Not offered in this run: page_startMonitor, page_monitorStatus, page_awaitMonitor, page_stopMonitor.'),
      firefox: [firefox.isError, texts(firefox)[0]],
    }).toEqual({
      offered: ['page_findProgress', 'page_startTimer', 'page_timerStatus', 'page_stopTimer'],
      missing: true,
      firefox: [true, 'UNAVAILABLE: None of the captcha tools are offered in this run; they run only in a Chromium browser such as Chrome or Edge, on a computer.'],
    });
  });

  test('an unknown name is answered with every guide there is', async () => {
    const reply = await open('sliders');
    expect([reply.isError, texts(reply)[0].split('\n').slice(0, 2)]).toEqual([
      true,
      ['UNKNOWN_SKILL: There is no guide named "sliders". The guides are:', '- captcha: get past a “verify you are human” check: reCAPTCHA, hCaptcha, Turnstile (Chromium browsers only)'],
    ]);
  });
});

describe('a call through browsentic_use', () => {
  test('reaches the bridge exactly as the listed tool would, and reads back the same', async () => {
    const answers = { 'page.dragElement': success({ dropped: true }) };
    const direct = fakeBridge(answers);
    const through = fakeBridge(answers);
    const input = { from: { text: 'Card' }, to: { text: 'Done' } };
    const replies = [
      await call(await connect(direct.bridge), 'page_dragElement', input),
      await call(await connect(through.bridge), 'browsentic_use', { action: 'page_dragElement', input }),
    ];
    expect([through.asked, replies[1].content.length, texts(replies[1])[0].replace(/[0-9a-f]{8,}/g, '')]).toEqual([
      direct.asked,
      replies[0].content.length,
      texts(replies[0])[0].replace(/[0-9a-f]{8,}/g, ''),
    ]);
  });

  test('takes the action as an agent CLI shows its tool', async () => {
    const { bridge, asked } = fakeBridge({ 'page.dragElement': success({ dragged: true }) });
    const client = await connect(bridge);
    for (const action of ['mcp__browsentic__page_dragElement', 'browsentic__page_dragElement', 'browsentic_page_dragElement']) {
      await call(client, 'browsentic_use', { action, input: { from: 1 } });
    }
    expect(asked.map(([action]) => action)).toEqual(['page.dragElement', 'page.dragElement', 'page.dragElement']);
  });

  test('takes the action as its tool, its action or bare, and the input as an object, a JSON string or flat', async () => {
    const { bridge, asked } = fakeBridge({ 'page.solveCaptcha': success({ state: 'solved' }) });
    const client = await connect(bridge);
    await call(client, 'browsentic_use', { action: 'page_solveCaptcha', input: { tiles: [1] } });
    await call(client, 'browsentic_use', { action: 'page.solveCaptcha', input: '{"tiles":[2]}' });
    await call(client, 'browsentic_use', { action: 'solveCaptcha', tiles: [3] });
    await call(client, 'browsentic_use', { action: 'solveCaptcha' });
    expect(asked).toEqual([
      ['page.solveCaptcha', { tiles: [1] }],
      ['page.solveCaptcha', { tiles: [2] }],
      ['page.solveCaptcha', { tiles: [3] }],
      ['page.solveCaptcha', {}],
    ]);
  });

  test("renders a result as its own tool does: an open captcha comes back as its picture", async () => {
    const challenge = { kind: 'tiles', prompt: 'Select all buses', image: PNG, imageWidth: 300, imageHeight: 300 };
    const client = await connect(fakeBridge({ 'page.solveCaptcha': success({ state: 'challenge', challenge }) }).bridge);
    const reply = await call(client, 'browsentic_use', { action: 'solveCaptcha' });
    expect(reply.content.map((part) => part.type)).toEqual(['text', 'image', 'text']);
  });

  test('invalid input comes back with the schema to correct it by', async () => {
    const client = await connect(fakeBridge({ 'page.dragElement': failure('INVALID_INPUT', '✖ Invalid input') }).bridge);
    const [text] = texts(await call(client, 'browsentic_use', { action: 'dragElement', input: { from: 3 } }));
    const schema = describeActions().find((action) => action.name === 'page.dragElement')!.inputSchema;
    expect(text).toBe(`INVALID_INPUT: ✖ Invalid input\npage_dragElement takes: ${JSON.stringify(schema)}`);
  });

  test('input that is not an object is refused before it reaches the browser', async () => {
    const { bridge, asked } = fakeBridge();
    const reply = await call(await connect(bridge), 'browsentic_use', { action: 'dragElement', input: '[1, 2' });
    expect([reply.isError, texts(reply)[0], asked]).toEqual([
      true,
      "INVALID_INPUT: input must be an object, or a JSON string of one, holding page_dragElement's parameters.",
      [],
    ]);
  });

  test('an action that does not exist, or is not a page action, is answered with the guides and never invoked', async () => {
    const { bridge, asked } = fakeBridge();
    const client = await connect(bridge);
    const replies = await Promise.all(['page_sliders', 'browsentic_status', 'browsentic_use'].map((action) => call(client, 'browsentic_use', { action })));
    expect([replies.map((reply) => texts(reply)[0].split('\n')[0]), asked]).toEqual([
      [
        'UNKNOWN_ACTION: There is no browser action named "page_sliders". Open the guide that covers what you need with browsentic_openSkill:',
        'UNKNOWN_ACTION: There is no browser action named "browsentic_status". Open the guide that covers what you need with browsentic_openSkill:',
        'UNKNOWN_ACTION: There is no browser action named "browsentic_use". Open the guide that covers what you need with browsentic_openSkill:',
      ],
      [],
    ]);
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

  test('an extension and a Bridge of different versions, and a tab it cannot read, are both explained', async () => {
    const status = await statusOf({ 'page.getPageInfo': failure('TAB_UNREACHABLE', 'chrome:// page') }, { manifestInSync: false });
    expect({ activeTab: status.activeTab, drifted: String(status.hint).includes('different versions'), unreadable: String(status.hint).includes('Cannot read the active tab (TAB_UNREACHABLE)') }).toEqual({
      activeTab: null,
      drifted: true,
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
