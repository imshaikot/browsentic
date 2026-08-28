import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ActionResult } from '@/lib/actions/protocol';
import { RESERVED_ACTIONS, RESERVED_PREFIX, SAVE_SITE_MAP_ACTION } from '@/lib/actions/reserved';
import { actionNameFor, assertToolNamesRoundTrip, toolNameFor } from '@/lib/actions/tool-names';
import { readAgentConfig } from './agent/config';
import type { Bridge } from './control';
import { IMAGE_NOTE, fence, fenceTag, policyFrom, sealSecrets, shouldFence } from './guardrails';
import { log } from './log';

const STATUS_TOOL = toolNameFor(`${RESERVED_PREFIX}status`);
const SCREENSHOT_TOOL = 'page_screenshot';

const RESOURCES = [
  {
    uri: 'browsentic://page/current',
    name: 'Active page snapshot',
    description: 'Full page.getPageInfo snapshot of the active tab: metadata, layout tree, headings, interactive inventory.',
    mimeType: 'application/json',
  },
  {
    uri: 'browsentic://page/diagram',
    name: 'Active page layout diagram',
    description: 'Text diagram of the active tab’s landmark regions — the cheapest useful view of a page.',
    mimeType: 'text/plain',
  },
  {
    uri: 'browsentic://page/text',
    name: 'Active page text',
    description: 'Rendered text of the active tab.',
    mimeType: 'text/plain',
  },
] as const;

const SAVE_SITE_MAP_TOOL = {
  name: toolNameFor(SAVE_SITE_MAP_ACTION),
  description:
    'Write up a finished site map. Call this exactly once, at the end of a mapping run. The map is staged for the user to review before it takes effect — it does not apply immediately.',
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['report'],
    properties: {
      report: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'pages'],
        properties: {
          summary: { type: 'string', description: 'What this site is, in two or three sentences.' },
          landmarks: {
            type: 'array',
            description: 'Durable parts of the interface: the primary nav, a search box, a cookie wall.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name'],
              properties: {
                name: { type: 'string', description: 'What it is called, as a person would say it.' },
                selector: { type: 'string', description: 'A CSS selector that finds it.' },
                note: { type: 'string', description: 'One line on how it behaves.' },
              },
            },
          },
          pages: {
            type: 'array',
            description: 'Each page visited, once.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'title', 'purpose'],
              properties: {
                path: { type: 'string', description: 'The path on the mapped site, e.g. /pricing.' },
                title: { type: 'string', description: 'The page title.' },
                purpose: { type: 'string', description: 'What the page is for, in one short phrase.' },
                reachedBy: { type: 'string', description: 'How you got there, e.g. "Pricing" in the top nav.' },
                screenshot: { type: 'string', description: 'Filename of a screenshot you took of this page.' },
                notes: { type: 'string', description: 'Anything else worth recording. Kept out of the prompt.' },
              },
            },
          },
          links: {
            type: 'array',
            description: 'How the pages connect: one entry per link you followed or saw.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['from', 'to'],
              properties: {
                from: { type: 'string', description: 'Path the link is on.' },
                to: { type: 'string', description: 'Path it leads to.' },
              },
            },
          },
          quirks: {
            type: 'array',
            description: 'Things that would trip up someone driving this site. Observations, never advice.',
            items: { type: 'string' },
          },
        },
      },
    },
  },
};

export function createMcpServer(bridge: Bridge, version: string, opts: { agentRun?: boolean } = {}): Server {
  // Page text is marked as data on the way out, for every client — the system prompt
  // that says so only reaches Browsentic's own runs. The tag is per-process so a page
  // cannot author a closing marker.
  const policy = policyFrom(readAgentConfig().guardrails);
  const tag = fenceTag();

  const server = new Server(
    { name: 'browsentic', version },
    {
      capabilities: { tools: { listChanged: true }, resources: {} },
      instructions:
        'Controls the user’s browser through the Browsentic extension. Tools act on the active tab. ' +
        'Start with page_getPageInfo (or the browsentic://page/diagram resource) to learn what is on the page and ' +
        'get stable selectors, then target elements by selector or visible text. ' +
        'page_screenshot hands the image back to you in the result and writes nothing to disk, so captures you take to see ' +
        'the page for yourself leave no files behind. Pass save: true only when the user asked for a picture they can keep; ' +
        'then read the returned savedTo path back so the image renders, and include that path in your reply. ' +
        'Passwords, keys, tokens and cookies are replaced in every result by a sealed placeholder such as ' +
        '⟦password:4f2a@example.com⟧; the real value stays in the browser. Pass a placeholder through unchanged as ' +
        'page_fillInput’s value or page_typeText’s text and it becomes the credential at the moment it reaches the field. ' +
        'Anywhere else it is refused, and it is never yours to read, rebuild or repeat.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const actions = await bridge.describe();
    assertToolNamesRoundTrip([...actions.map((action) => action.name), ...RESERVED_ACTIONS]);
    return {
      tools: [
        ...actions.map((action) => ({
          name: toolNameFor(action.name),
          description: action.description,
          inputSchema: action.inputSchema as { type: 'object' },
        })),
        {
          name: STATUS_TOOL,
          description:
            'Report whether the Browsentic browser extension is connected, its version, and the active tab. Use this first if a page tool fails.',
          inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
        },
        ...(opts.agentRun ? [SAVE_SITE_MAP_TOOL] : []),
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name === STATUS_TOOL) return render(await status(bridge));
    const action = actionNameFor(params.name);
    const result = await bridge.invoke(action, params.arguments ?? {});
    if (params.name === SCREENSHOT_TOOL) return renderScreenshot(result);
    return render(result, shouldFence(action, policy) ? tag : undefined);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [...RESOURCES] }));

  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const { uri } = params;
    const resource = RESOURCES.find((candidate) => candidate.uri === uri);
    if (!resource) throw new Error(`Unknown resource: ${uri}`);

    // Resources are read straight into the client's context, so they are fenced the
    // same way tool results are.
    const wrap = (body: string) => {
      const sealed = sealSecrets(body);
      return policy.fence.enabled ? fence(sealed, tag) : sealed;
    };

    if (uri === 'browsentic://page/text') {
      const result = await bridge.invoke('page.extractText', { format: 'text' });
      return text(uri, resource.mimeType, wrap(unwrap(result, (data) => String((data as { content: string }).content))));
    }
    const result = await bridge.invoke('page.getPageInfo', { maxPerKind: uri === 'browsentic://page/diagram' ? 1 : 30 });
    if (uri === 'browsentic://page/diagram') {
      return text(uri, resource.mimeType, wrap(unwrap(result, (data) => String((data as PageInfo).layout.diagram))));
    }
    return text(uri, resource.mimeType, wrap(unwrap(result, (data) => JSON.stringify(data, null, 2))));
  });

  bridge.onManifestChanged(() => {
    log('manifest changed; notifying MCP client');
    void server.sendToolListChanged().catch((error) => log('failed to notify tool list change', error));
  });

  return server;
}

interface PageInfo {
  document: { url: string; title: string };
  layout: { diagram: string };
}

async function status(bridge: Bridge) {
  const base = await bridge.status();
  if (!base.connected) {
    return {
      ok: true as const,
      data: { ...base, activeTab: null, hint: 'Open your browser with the Browsentic extension loaded.' },
    };
  }
  const monitors = await activeMonitors(bridge);
  const page = await bridge.invoke('page.getPageInfo', { maxPerKind: 1 });
  const hints = [
    base.manifestInSync
      ? ''
      : 'The extension is running an older build than the daemon, so your tool list came from the extension and is stale — capabilities that exist in this repository may be missing entirely. You cannot fix this yourself: tell the user to run `yarn build && yarn daemon:build` and then press Reload on Browsentic at chrome://extensions. Do not improvise around a tool you think should exist.',
    page.ok ? '' : `Cannot read the active tab (${page.error.code}). Use page_navigate to open an http(s) page first.`,
  ].filter(Boolean);

  return {
    ok: true as const,
    data: {
      ...base,
      activeTab: page.ok ? (page.data as PageInfo).document : null,
      ...monitors,
      ...(hints.length ? { hint: hints.join(' ') } : {}),
    },
  };
}

interface MonitorSummary {
  monitorId: string;
  label?: string;
  host: string;
  phase: string;
  percent?: number;
}

async function activeMonitors(bridge: Bridge): Promise<{ monitors: MonitorSummary[] } | undefined> {
  const result = await bridge.invoke('page.monitorStatus', {});
  if (!result.ok) return undefined;
  const monitors = (result.data as { monitors?: MonitorSummary[] } | null)?.monitors;
  if (!monitors?.length) return undefined;
  return { monitors: monitors.map(({ monitorId, label, host, phase, percent }) => ({ monitorId, label, host, phase, percent })) };
}

function renderScreenshot(result: ActionResult) {
  if (!result.ok) return render(result);
  const data = result.data as {
    dataUrl?: string;
    format?: string;
    width?: number;
    height?: number;
    savedTo?: string;
    saveError?: string;
    truncated?: boolean;
  };
  if (typeof data.dataUrl !== 'string') return render(result);

  const [mimeType, base64] = splitDataUrl(data.dataUrl);
  const notes = [
    IMAGE_NOTE,
    `Captured ${data.width}×${data.height} ${data.format ?? 'image'}.`,
    data.truncated ? 'The page was taller than the capture limit, so the bottom is cut off.' : '',
    data.savedTo
      ? `Saved to ${data.savedTo}. Show this screenshot to the user: read that path so the image renders, and include the path in your reply.`
      : '',
    data.saveError ? `Requested save failed: ${data.saveError}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    content: [
      { type: 'image' as const, data: base64, mimeType },
      { type: 'text' as const, text: sealSecrets(notes) },
    ],
  };
}

function splitDataUrl(dataUrl: string): [mimeType: string, base64: string] {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return match ? [match[1], match[2]] : ['image/png', ''];
}

/**
 * `fenceWith` marks the payload as untrusted page data. Failures are left bare: they
 * are daemon-authored and the run preamble teaches the agent to read `CODE: message`.
 *
 * The seal runs on every body, fenced or not. The extension has normally sealed already
 * and this pass leaves its handles alone; what it catches is a result that reached the
 * daemon another way.
 */
function render(result: ActionResult, fenceWith?: string) {
  if (result.ok) {
    const body = sealSecrets(JSON.stringify(result.data, null, 2));
    return { content: [{ type: 'text' as const, text: fenceWith ? fence(body, fenceWith) : body }] };
  }
  return {
    isError: true,
    content: [{ type: 'text' as const, text: sealSecrets(`${result.error.code}: ${result.error.message}`) }],
  };
}

function unwrap(result: ActionResult, project: (data: unknown) => string): string {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return project(result.data);
}

function text(uri: string, mimeType: string, body: string) {
  return { contents: [{ uri, mimeType, text: body }] };
}
