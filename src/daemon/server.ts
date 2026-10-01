import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ActionResult } from '@/lib/actions/protocol';
import { readAgentConfig } from './agent/config';
import type { Bridge } from './control';
import { fence, fenceTag, policyFrom, sealSecrets } from './guardrails';
import { log } from './log';
import { toolHost } from './tool-host';

const RESOURCES = [
  {
    uri: 'browsentic://page/current',
    name: 'Active page snapshot',
    description: 'Full page.getPageInfo snapshot of the active tab: metadata, layout diagram, headings, interactive inventory.',
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

export function createMcpServer(bridge: Bridge, version: string, opts: { agentRun?: boolean; resultBytes?: number } = {}): Server {
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
        'Anywhere else it is refused, and it is never yours to read, rebuild or repeat. ' +
        'SITE_BLOCKED means the user has put that site off-limits to Browsentic: do not retry it or reach it another way — tell the user.',
    },
  );

  const tools = toolHost(bridge, { agentRun: opts.agentRun, resultBytes: opts.resultBytes, policy, tag });

  // A client listed again sees whatever is withheld once it is offered, so there is nothing to list ahead.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await tools.list()).tools }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => ({
    ...(await tools.call(params.name, params.arguments ?? {}, extra.signal)),
  }));

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

function unwrap(result: ActionResult, project: (data: unknown) => string): string {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return project(result.data);
}

function text(uri: string, mimeType: string, body: string) {
  return { contents: [{ uri, mimeType, text: body }] };
}
