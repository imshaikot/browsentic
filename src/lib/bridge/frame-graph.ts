import type { Point } from '@/lib/actions/page/pointer';
import { onDebuggerEvent, send as sendNow, settle, type DebuggerSession } from './cdp';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameNode {
  id: string;
  url: string;
  parentId?: string;
  session: DebuggerSession;
}

export interface FrameBox extends Rect {
  shown: boolean;
  opacity: number;
}

export interface Layout {
  width: number;
  height: number;
  pageX: number;
  pageY: number;
  pixelRatio: number;
}

interface AttachedTarget {
  sessionId: string;
  targetInfo?: { type?: string };
}

interface FrameTree {
  frame: { id: string; parentId?: string; url: string; urlFragment?: string };
  childFrames?: FrameTree[];
}

interface DomNode {
  nodeId: number;
  backendNodeId: number;
  frameId?: string;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

interface Returned<T> {
  result?: { value?: T };
  exceptionDetails?: unknown;
}

const AUTO_ATTACH = { autoAttach: true, flatten: true, waitForDebuggerOnStart: false, filter: [{ type: 'iframe' }] };
const AUTO_ATTACH_OFF = { autoAttach: false, flatten: true, waitForDebuggerOnStart: false };
const ATTACH_SETTLE_MS = 250;
const WORLD_NAME = 'browsentic-captcha';
const COMMAND_TIMEOUT_MS = 5_000;

/** A frame that stops answering mid-navigation must not hold up everything waiting on it. */
function send<T>(session: DebuggerSession, method: string, params?: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${method} did not answer`)), COMMAND_TIMEOUT_MS);
  });
  return Promise.race([sendNow<T>(session, method, params), late]).finally(() => clearTimeout(timer));
}

/**
 * Every frame in one tab as Chrome's debugger sees it — the ones rendered in the page's own
 * process and the out-of-process ones handed over as child sessions — however deeply they
 * nest and whether or not their owner element sits in a closed shadow root. It stays
 * subscribed for as long as the debugger is attached, so a frame that appears later, such
 * as a challenge popping up after a click, is part of the next view.
 */
export class FrameGraph {
  private readonly children = new Map<string, DebuggerSession>();
  private readonly domEnabled = new Set<string>();
  private readonly unsubscribe: () => void;

  private constructor(readonly root: DebuggerSession) {
    this.unsubscribe = onDebuggerEvent((source, method, params) => this.observe(source, method, params));
  }

  static async open(root: DebuggerSession): Promise<FrameGraph> {
    const graph = new FrameGraph(root);
    await graph.follow(root);
    await settle(ATTACH_SETTLE_MS);
    return graph;
  }

  async close(): Promise<void> {
    this.unsubscribe();
    for (const child of [...this.children.values()].reverse()) {
      await send(child, 'Target.setAutoAttach', AUTO_ATTACH_OFF).catch(() => {});
    }
  }

  async view(): Promise<FrameView> {
    const frames = new Map<string, FrameNode>();
    for (const session of [this.root, ...this.children.values()]) {
      const reply = await send<{ frameTree?: FrameTree }>(session, 'Page.getFrameTree').catch(() => null);
      if (reply?.frameTree) collectFrames(reply.frameTree, session, frames);
    }
    return new FrameView(this.root, frames, this.domEnabled);
  }

  private follow(session: DebuggerSession): Promise<unknown> {
    return send(session, 'Target.setAutoAttach', AUTO_ATTACH).catch(() => {});
  }

  private observe(source: DebuggerSession, method: string, params?: object): void {
    if (source.tabId !== this.root.tabId) return;
    if (method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = params as AttachedTarget;
      if (targetInfo?.type !== 'iframe' || this.children.has(sessionId)) return;
      const child: DebuggerSession = { tabId: this.root.tabId, sessionId };
      this.children.set(sessionId, child);
      void this.follow(child);
    }
    if (method === 'Target.detachedFromTarget') {
      const { sessionId } = params as { sessionId: string };
      this.children.delete(sessionId);
      this.domEnabled.delete(sessionId);
    }
  }
}

/**
 * One moment's reading of the graph. Positions and isolated worlds are worked out once per
 * frame and remembered, so a view is cheap to ask repeatedly and is thrown away as soon as
 * the page may have moved.
 */
export class FrameView {
  private readonly worlds = new Map<string, Promise<number | null>>();
  private readonly origins = new Map<string, Promise<Point | null>>();

  constructor(
    readonly root: DebuggerSession,
    private readonly frames: Map<string, FrameNode>,
    private readonly domEnabled: Set<string>,
  ) {}

  list(): FrameNode[] {
    return [...this.frames.values()];
  }

  get(frameId: string): FrameNode | undefined {
    return this.frames.get(frameId);
  }

  top(): FrameNode | undefined {
    return this.list().find((frame) => !frame.parentId && !frame.session.sessionId);
  }

  parentOf(frame: FrameNode): FrameNode | undefined {
    return frame.parentId ? this.frames.get(frame.parentId) : undefined;
  }

  run<T, A extends unknown[]>(frame: FrameNode, fn: (...args: A) => T, ...args: A): Promise<Awaited<T> | undefined> {
    return this.runWith(frame, [], fn, ...args);
  }

  /** Runs `fn` in the frame with `helpers` declared beside it, since a function travels as its source alone. */
  async runWith<T, A extends unknown[]>(
    frame: FrameNode,
    helpers: ((...args: never[]) => unknown)[],
    fn: (...args: A) => T,
    ...args: A
  ): Promise<Awaited<T> | undefined> {
    const contextId = await this.world(frame);
    if (contextId == null) return undefined;
    const declared = helpers.map((helper) => helper.toString()).join('\n');
    const reply = await send<Returned<Awaited<T>>>(frame.session, 'Runtime.evaluate', {
      expression: `(() => {\n${declared}\nreturn (${fn.toString()})(...${JSON.stringify(args)});\n})()`,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    }).catch(() => null);
    return reply?.exceptionDetails ? undefined : reply?.result?.value;
  }

  async evaluate(frame: FrameNode, expression: string): Promise<unknown> {
    const contextId = await this.world(frame);
    if (contextId == null) return undefined;
    const reply = await send<Returned<unknown>>(frame.session, 'Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
    }).catch(() => null);
    return reply?.exceptionDetails ? undefined : reply?.result?.value;
  }

  async callOn<T>(frame: FrameNode, backendNodeId: number, fn: (this: Element) => T): Promise<T | undefined> {
    const contextId = await this.world(frame);
    if (contextId == null) return undefined;
    await this.enableDom(frame.session);
    const resolved = await send<{ object?: { objectId?: string } }>(frame.session, 'DOM.resolveNode', {
      backendNodeId,
      executionContextId: contextId,
    }).catch(() => null);
    const objectId = resolved?.object?.objectId;
    if (!objectId) return undefined;
    const reply = await send<Returned<T>>(frame.session, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: fn.toString(),
      returnByValue: true,
    }).catch(() => null);
    void send(frame.session, 'Runtime.releaseObject', { objectId }).catch(() => {});
    return reply?.exceptionDetails ? undefined : reply?.result?.value;
  }

  /** Where the frame's own viewport starts, in the tab's viewport. */
  origin(frame: FrameNode): Promise<Point | null> {
    return remembered(this.origins, frame.id, async () => {
      const parent = this.parentOf(frame);
      if (!parent) return frame.session.sessionId ? null : { x: 0, y: 0 };
      const [base, owner] = await Promise.all([this.origin(parent), this.ownerBox(frame)]);
      return base && owner ? { x: base.x + owner.x, y: base.y + owner.y } : null;
    });
  }

  /** The frame's box in the tab's viewport, and whether anything along its chain hides it. */
  async box(frame: FrameNode): Promise<FrameBox | null> {
    const parent = this.parentOf(frame);
    if (!parent) {
      const { width, height } = await this.layout();
      return { x: 0, y: 0, width, height, shown: true, opacity: 1 };
    }
    const [base, owner, above] = await Promise.all([this.origin(parent), this.ownerBox(frame), this.box(parent)]);
    if (!base || !owner || !above) return null;
    return {
      ...owner,
      x: base.x + owner.x,
      y: base.y + owner.y,
      shown: owner.shown && above.shown,
      opacity: owner.opacity * above.opacity,
    };
  }

  async rectOf(frame: FrameNode, backendNodeId: number): Promise<Rect | null> {
    const [base, local] = await Promise.all([this.origin(frame), this.callOn(frame, backendNodeId, clientRect)]);
    return base && local ? { ...local, x: base.x + local.x, y: base.y + local.y } : null;
  }

  async scrollIntoView(frame: FrameNode, backendNodeId: number): Promise<void> {
    await this.enableDom(frame.session);
    await send(frame.session, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {});
  }

  async ownerNode(frame: FrameNode): Promise<{ host: FrameNode; backendNodeId: number } | null> {
    const host = this.parentOf(frame);
    if (!host) return null;
    await this.enableDom(host.session);
    const owner = await send<{ backendNodeId?: number }>(host.session, 'DOM.getFrameOwner', { frameId: frame.id }).catch(
      () => null,
    );
    return owner?.backendNodeId ? { host, backendNodeId: owner.backendNodeId } : null;
  }

  /**
   * Nodes matching a selector anywhere in the frame's own document, closed shadow roots
   * included — the debugger's copy of the tree has them all, where page script sees none.
   */
  async deepQuery(frame: FrameNode, selector: string): Promise<number[]> {
    await this.enableDom(frame.session);
    const reply = await send<{ root?: DomNode }>(frame.session, 'DOM.getDocument', { depth: -1, pierce: true }).catch(
      () => null,
    );
    const own = reply?.root && (this.rootsItsSession(frame) ? reply.root : documentOf(reply.root, frame.id));
    if (!own) return [];

    const backend = new Map<number, number>();
    const found: number[] = [];
    for (const nodeId of scopesOf(own, backend)) {
      const matched = await send<{ nodeIds?: number[] }>(frame.session, 'DOM.querySelectorAll', { nodeId, selector }).catch(
        () => null,
      );
      for (const id of matched?.nodeIds ?? []) {
        const backendNodeId = backend.get(id);
        if (backendNodeId) found.push(backendNodeId);
      }
    }
    return found;
  }

  async layout(): Promise<Layout> {
    const metrics = await send<{
      cssVisualViewport?: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
      visualViewport?: { clientWidth: number };
    }>(this.root, 'Page.getLayoutMetrics').catch(() => null);
    const viewport = metrics?.cssVisualViewport;
    const devicePixels = metrics?.visualViewport?.clientWidth;
    return {
      width: viewport?.clientWidth ?? 0,
      height: viewport?.clientHeight ?? 0,
      pageX: viewport?.pageX ?? 0,
      pageY: viewport?.pageY ?? 0,
      pixelRatio: viewport?.clientWidth && devicePixels ? devicePixels / viewport.clientWidth : 1,
    };
  }

  private rootsItsSession(frame: FrameNode): boolean {
    return this.parentOf(frame)?.session !== frame.session;
  }

  private async ownerBox(frame: FrameNode): Promise<FrameBox | null> {
    const owner = await this.ownerNode(frame);
    return (owner && (await this.callOn(owner.host, owner.backendNodeId, contentBox))) ?? null;
  }

  private world(frame: FrameNode): Promise<number | null> {
    return remembered(this.worlds, frame.id, async () => {
      const reply = await send<{ executionContextId?: number }>(frame.session, 'Page.createIsolatedWorld', {
        frameId: frame.id,
        worldName: WORLD_NAME,
      }).catch(() => null);
      return reply?.executionContextId ?? null;
    });
  }

  private async enableDom(session: DebuggerSession): Promise<void> {
    const key = session.sessionId ?? '';
    if (this.domEnabled.has(key)) return;
    this.domEnabled.add(key);
    await send(session, 'DOM.enable').catch(() => {});
  }
}

function collectFrames(tree: FrameTree, session: DebuggerSession, into: Map<string, FrameNode>): void {
  const { id, parentId, url, urlFragment } = tree.frame;
  into.set(id, { id, parentId, url: `${url}${urlFragment ?? ''}`, session });
  for (const child of tree.childFrames ?? []) collectFrames(child, session, into);
}

function documentOf(node: DomNode, frameId: string): DomNode | undefined {
  if (node.frameId === frameId && node.contentDocument) return node.contentDocument;
  const next = [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])];
  for (const child of next) {
    const found = documentOf(child, frameId);
    if (found) return found;
  }
  return undefined;
}

function scopesOf(document: DomNode, backend: Map<number, number>): number[] {
  const scopes = [document.nodeId];
  const visit = (node: DomNode) => {
    backend.set(node.nodeId, node.backendNodeId);
    for (const shadow of node.shadowRoots ?? []) {
      scopes.push(shadow.nodeId);
      visit(shadow);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document);
  return scopes;
}

function remembered<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const held = cache.get(key);
  if (held) return held;
  const made = make();
  cache.set(key, made);
  return made;
}

function clientRect(this: Element): Rect {
  const rect = this.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function contentBox(this: Element): FrameBox {
  const rect = this.getBoundingClientRect();
  const style = getComputedStyle(this);
  const px = (value: string) => parseFloat(value) || 0;
  let opacity = 1;
  let displayed = true;
  for (let at: Element | undefined = this; at && displayed; at = at.parentElement ?? (at.getRootNode() as ShadowRoot).host) {
    const own = getComputedStyle(at);
    opacity *= Number(own.opacity);
    displayed = own.display !== 'none';
  }
  const width = this.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
  const height = this.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
  return {
    x: rect.left + this.clientLeft + px(style.paddingLeft),
    y: rect.top + this.clientTop + px(style.paddingTop),
    width,
    height,
    shown: displayed && style.visibility !== 'hidden' && opacity > 0.05 && width > 0 && height > 0,
    opacity,
  };
}
