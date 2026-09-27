import type { ToolDescriptor } from '@/lib/actions/manifest';
import type { ActionResult } from '@/lib/actions/protocol';
import { FOCUS_SHOT_ACTION, RESERVED_ACTIONS, SAVE_SITE_MAP_ACTION } from '@/lib/actions/reserved';
import { actionNameFor, assertToolNamesRoundTrip, STATUS_TOOL, toolNameFor } from '@/lib/actions/tool-names';
import type { Bridge } from './control';
import { IMAGE_NOTE, fence, sealSecrets, shouldFence, type Policy } from './guardrails';

const SCREENSHOT_TOOL = 'page_screenshot';
const PICK_TOOL = 'page_pickElement';
const CAPTCHA_TOOL = 'page_solveCaptcha';

const FOCUS_SHOT_TOOL = {
  name: toolNameFor(FOCUS_SHOT_ACTION),
  description:
    'Show the screenshot of the element the user pointed at with A-Eye, taken at the instant they picked it. ' +
    'Only answers when the current instruction arrived with a pick attached.',
  inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
};

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

const RESERVED_TOOLS = [
  { action: SAVE_SITE_MAP_ACTION, descriptor: SAVE_SITE_MAP_TOOL },
  { action: FOCUS_SHOT_ACTION, descriptor: FOCUS_SHOT_TOOL },
];

export interface ListedTool {
  name: string;
  description: string;
  inputSchema: { type: 'object' } & Record<string, unknown>;
}

export interface ToolList {
  tools: ListedTool[];
  /** Offered later in the conversation, perhaps — see `Described.withheld`. */
  withheld: ListedTool[];
}

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolReply {
  content: ToolContent[];
  isError?: boolean;
}

/**
 * The browser's tools as an agent sees them — listed, called, and their results sealed, fenced and
 * turned into pictures where they hold one. The MCP server serves these to any client; a CLI that
 * takes its tools some other way is handed the same host, so a result reads the same either way.
 */
export interface ToolHost {
  list(): Promise<ToolList>;
  call(name: string, args: Record<string, unknown>): Promise<ToolReply>;
}

export function toolHost(bridge: Bridge, { agentRun = false, policy, tag }: { agentRun?: boolean; policy: Policy; tag: string }): ToolHost {
  return {
    async list() {
      const { tools: actions, reserved = agentRun ? RESERVED_TOOLS.map((tool) => tool.action) : [], withheld = [] } = await bridge.describe();
      assertToolNamesRoundTrip([...actions.map((action) => action.name), ...RESERVED_ACTIONS]);
      return {
        tools: [
          ...actions.map(listed),
          {
            name: STATUS_TOOL,
            description:
              'Report whether the Browsentic browser extension is connected, its version, and the active tab. Use this first if a page tool fails.',
            inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
          },
          ...RESERVED_TOOLS.filter((tool) => reserved.includes(tool.action)).map((tool) => tool.descriptor),
        ],
        withheld: withheld.map(listed),
      };
    },

    async call(name, args) {
      if (name === STATUS_TOOL) return render(await status(bridge));
      const action = actionNameFor(name);
      const result = await bridge.invoke(action, args);
      const fenceWith = shouldFence(action, policy) ? tag : undefined;
      if (name === SCREENSHOT_TOOL) return renderScreenshot(result);
      if (name === FOCUS_SHOT_TOOL.name) return renderFocusShot(result);
      if (name === PICK_TOOL) return renderPick(result, fenceWith);
      if (name === CAPTCHA_TOOL) return renderCaptcha(result, fenceWith);
      return render(result, fenceWith);
    },
  };
}

const listed = (action: ToolDescriptor): ListedTool => ({
  name: toolNameFor(action.name),
  description: action.description,
  inputSchema: action.inputSchema as ListedTool['inputSchema'],
});

interface PageInfo {
  document: { url: string; title: string };
}

async function status(bridge: Bridge): Promise<ActionResult> {
  const base = await bridge.status();
  if (!base.connected) {
    return { ok: true, data: { ...base, activeTab: null, hint: 'Open your browser with the Browsentic extension loaded.' } };
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
    ok: true,
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

function renderScreenshot(result: ActionResult): ToolReply {
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
      { type: 'image', data: base64, mimeType },
      { type: 'text', text: sealSecrets(notes) },
    ],
  };
}

function renderPick(result: ActionResult, fenceWith?: string): ToolReply {
  if (!result.ok) return render(result, fenceWith);
  const { shot, ...rest } = result.data as { shot?: { dataUrl?: string; width?: number; height?: number } } & Record<
    string,
    unknown
  >;
  if (typeof shot?.dataUrl !== 'string') return render(result, fenceWith);

  const [mimeType, base64] = splitDataUrl(shot.dataUrl);
  const rendered = render({ ok: true, data: rest }, fenceWith);
  return {
    content: [
      ...rendered.content,
      { type: 'image', data: base64, mimeType },
      { type: 'text', text: `${IMAGE_NOTE} This is the picked element photographed at the instant the user clicked it.` },
    ],
  };
}

/** An open challenge comes back as a picture beside its description, so the caller can answer it by looking. */
function renderCaptcha(result: ActionResult, fenceWith?: string): ToolReply {
  if (!result.ok) return render(result, fenceWith);
  const data = result.data as { challenge?: { image?: unknown } & Record<string, unknown> } & Record<string, unknown>;
  const image = data.challenge?.image;
  if (typeof image !== 'string') return render(result, fenceWith);

  const { image: _image, ...challenge } = data.challenge!;
  const [mimeType, base64] = splitDataUrl(image);
  const rendered = render({ ok: true, data: { ...data, challenge } }, fenceWith);
  return {
    content: [
      ...rendered.content,
      { type: 'image', data: base64, mimeType },
      {
        type: 'text',
        text: `${IMAGE_NOTE} This is the open captcha challenge, ${challenge.imageWidth}×${challenge.imageHeight} pixels${
          challenge.kind === 'tiles' ? ', each tile numbered in its corner' : ''
        }.`,
      },
    ],
  };
}

function renderFocusShot(result: ActionResult): ToolReply {
  if (!result.ok) return render(result);
  const dataUrl = (result.data as { dataUrl?: unknown } | null)?.dataUrl;
  if (typeof dataUrl !== 'string') return render(result);

  const [mimeType, base64] = splitDataUrl(dataUrl);
  return {
    content: [
      { type: 'image', data: base64, mimeType },
      { type: 'text', text: `${IMAGE_NOTE} This is the element the user pointed at with A-Eye, as it stood when they picked it.` },
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
function render(result: ActionResult, fenceWith?: string): ToolReply {
  if (result.ok) {
    const body = sealSecrets(JSON.stringify(result.data));
    return { content: [{ type: 'text', text: fenceWith ? fence(body, fenceWith) : body }] };
  }
  return { isError: true, content: [{ type: 'text', text: sealSecrets(`${result.error.code}: ${result.error.message}`) }] };
}
