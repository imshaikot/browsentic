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
import type { Bridge } from './control';
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
  const server = new Server(
    { name: 'browsentic', version },
    {
      capabilities: { tools: { listChanged: true }, resources: {} },
      instructions:
        'Controls the user’s browser through the Browsentic extension. Tools act on the active tab. ' +
        'Start with page_getPageInfo (or the browsentic://page/diagram resource) to learn what is on the page and ' +
        'get stable selectors, then target elements by selector or visible text. ' +
        'page_screenshot saves every capture to disk unless you pass save: false, and reports the file as savedTo. ' +
        'Always show the user the screenshot itself — read savedTo back so the image renders — and include that path in your reply.',
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
    const result = await bridge.invoke(actionNameFor(params.name), params.arguments ?? {});
    return params.name === SCREENSHOT_TOOL ? renderScreenshot(result) : render(result);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [...RESOURCES] }));

  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const { uri } = params;
    const resource = RESOURCES.find((candidate) => candidate.uri === uri);
    if (!resource) throw new Error(`Unknown resource: ${uri}`);

    if (uri === 'browsentic://page/text') {
      const result = await bridge.invoke('page.extractText', { format: 'text' });
      return text(uri, resource.mimeType, unwrap(result, (data) => String((data as { content: string }).content)));
    }
    const result = await bridge.invoke('page.getPageInfo', { maxPerKind: uri === 'browsentic://page/diagram' ? 1 : 30 });
    if (uri === 'browsentic://page/diagram') {
      return text(uri, resource.mimeType, unwrap(result, (data) => String((data as PageInfo).layout.diagram)));
    }
    return text(uri, resource.mimeType, unwrap(result, (data) => JSON.stringify(data, null, 2)));
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
  const page = await bridge.invoke('page.getPageInfo', { maxPerKind: 1 });
  if (page.ok) return { ok: true as const, data: { ...base, activeTab: (page.data as PageInfo).document } };
  return {
    ok: true as const,
    data: {
      ...base,
      activeTab: null,
      hint: `Cannot read the active tab (${page.error.code}). Use page_navigate to open an http(s) page first.`,
    },
  };
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
      { type: 'text' as const, text: notes },
    ],
  };
}

function splitDataUrl(dataUrl: string): [mimeType: string, base64: string] {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return match ? [match[1], match[2]] : ['image/png', ''];
}

function render(result: ActionResult) {
  if (result.ok) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
  }
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `${result.error.code}: ${result.error.message}` }],
  };
}

function unwrap(result: ActionResult, project: (data: unknown) => string): string {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return project(result.data);
}

function text(uri: string, mimeType: string, body: string) {
  return { contents: [{ uri, mimeType, text: body }] };
}
