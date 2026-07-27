import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ActionResult } from '@/lib/actions/protocol';
import { actionNameFor, assertToolNamesRoundTrip, toolNameFor } from '@/lib/actions/tool-names';
import type { Bridge } from './control';
import { log } from './log';

const STATUS_TOOL = 'voicelink_status';
const SCREENSHOT_TOOL = 'page_screenshot';

const RESOURCES = [
  {
    uri: 'voicelink://page/current',
    name: 'Active page snapshot',
    description: 'Full page.getPageInfo snapshot of the active tab: metadata, layout tree, headings, interactive inventory.',
    mimeType: 'application/json',
  },
  {
    uri: 'voicelink://page/diagram',
    name: 'Active page layout diagram',
    description: 'Text diagram of the active tab’s landmark regions — the cheapest useful view of a page.',
    mimeType: 'text/plain',
  },
  {
    uri: 'voicelink://page/text',
    name: 'Active page text',
    description: 'Rendered text of the active tab.',
    mimeType: 'text/plain',
  },
] as const;

/**
 * The one tool that writes rather than looks. It is advertised only to a spawned agent run —
 * `daemon.invoke` refuses the whole `voicelink.` namespace for anyone else, so an external MCP
 * client could not use it even if it guessed the name.
 *
 * No `actionNameFor` special case is needed: that helper replaces only the *first* underscore,
 * so `voicelink_saveSiteMap` already maps to `voicelink.saveSiteMap`, and CallTool's existing
 * fall-through routes it with the run id attached.
 */
const SAVE_SITE_MAP_TOOL = {
  name: 'voicelink_saveSiteMap',
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
    { name: 'voicelink', version },
    {
      capabilities: { tools: { listChanged: true }, resources: {} },
      instructions:
        'Controls the user’s browser through the VoiceLink extension. Tools act on the active tab. ' +
        'Start with page_getPageInfo (or the voicelink://page/diagram resource) to learn what is on the page and ' +
        'get stable selectors, then target elements by selector or visible text.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const actions = await bridge.describe();
    assertToolNamesRoundTrip(actions.map((action) => action.name));
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
            'Report whether the VoiceLink browser extension is connected, its version, and the active tab. Use this first if a page tool fails.',
          inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
        },
        ...(opts.agentRun ? [SAVE_SITE_MAP_TOOL] : []),
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name === STATUS_TOOL) return render(await status(bridge));
    const result = await bridge.invoke(actionNameFor(params.name), params.arguments ?? {});
    // A screenshot comes back as an image the model can actually see, not JSON.
    return params.name === SCREENSHOT_TOOL ? renderScreenshot(result) : render(result);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [...RESOURCES] }));

  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const { uri } = params;
    const resource = RESOURCES.find((candidate) => candidate.uri === uri);
    if (!resource) throw new Error(`Unknown resource: ${uri}`);

    if (uri === 'voicelink://page/text') {
      const result = await bridge.invoke('page.extractText', { format: 'text' });
      return text(uri, resource.mimeType, unwrap(result, (data) => String((data as { content: string }).content)));
    }
    const result = await bridge.invoke('page.getPageInfo', { maxPerKind: uri === 'voicelink://page/diagram' ? 1 : 30 });
    if (uri === 'voicelink://page/diagram') {
      return text(uri, resource.mimeType, unwrap(result, (data) => String((data as PageInfo).layout.diagram)));
    }
    return text(uri, resource.mimeType, unwrap(result, (data) => JSON.stringify(data, null, 2)));
  });

  // The connected extension may ship a different registry than this build; re-advertise if so.
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
      data: { ...base, activeTab: null, hint: 'Open your browser with the VoiceLink extension loaded.' },
    };
  }
  // getPageInfo is the cheapest way to see the active tab without a `tabs` permission.
  const page = await bridge.invoke('page.getPageInfo', { maxPerKind: 1 });
  if (page.ok) return { ok: true as const, data: { ...base, activeTab: (page.data as PageInfo).document } };
  return {
    ok: true as const,
    data: {
      ...base,
      activeTab: null,
      // Almost always a page that hosts no content script; page_navigate still works there.
      hint: `Cannot read the active tab (${page.error.code}). Use page_navigate to open an http(s) page first.`,
    },
  };
}

/**
 * Screenshots return an MCP image content block so the model — an external client or the spawned
 * agent, both of which pass through here — can look at the pixels, plus a text line with the
 * dimensions and where it was saved. The base64 is never dumped as text.
 */
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
    data.savedTo ? `Saved to ${data.savedTo}.` : '',
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

/** Split a `data:<mime>;base64,<payload>` URL into its parts for an MCP image content block. */
function splitDataUrl(dataUrl: string): [mimeType: string, base64: string] {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return match ? [match[1], match[2]] : ['image/png', ''];
}

/** Failures come back as tool errors so the model can adapt (retry a target, open a page) rather than abort. */
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
