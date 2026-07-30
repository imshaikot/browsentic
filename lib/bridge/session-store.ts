import { browser } from 'wxt/browser';
import type { RunItem } from './use-run';
import { nameSession } from './socket';

/**
 * The extension's library of past conversations, in `browser.storage.local` (the
 * `unlimitedStorage` permission lifts the default quota). Same two shapes as the file and skill
 * stores, split so a title arriving never rewrites the transcript:
 *
 *   'voicelink:sessions'      -> StoredSessionMeta[]        the small, reactive index the list reads
 *   'voicelink:session:<id>'  -> StoredSessionTranscript    the rows, read only on restore
 *
 * Unlike those two, this store is written continuously while a conversation happens rather than
 * once per user action, so it is the first store here that enforces its own caps — see MAX_SESSIONS
 * and MAX_ITEMS below. The side panel owns the writes (`use-run.ts`); the background worker only
 * reads, to run the naming round-trip.
 */

/** The reactive index — never holds transcript rows. */
export const SESSIONS_INDEX_KEY = 'voicelink:sessions';

const transcriptKey = (id: string) => `voicelink:session:${id}`;

/**
 * How many conversations to keep. Sessions accumulate on their own, with no user action to prompt
 * pruning, so something has to bound them; the oldest fall off the tail and their transcripts are
 * removed with them.
 */
const MAX_SESSIONS = 50;

/**
 * How many rows to keep per conversation. Trimmed from the *head*, so a long session restores as
 * its most recent 500 rows rather than its first 500 — the tail is what the next message follows on
 * from. The agent's own memory is unaffected either way: that lives in the Claude Code session.
 */
const MAX_ITEMS = 500;

/** Turn counts at which the name is (re)generated, so a session that drifted gets a name that fits. */
export const TITLE_TURNS = [1, 5, 15] as const;

/** A saved conversation, as the history list sees it. */
export interface StoredSessionMeta {
  id: string;
  /** Model-generated. Absent until the first naming round-trip lands. */
  title?: string;
  /** The host the conversation was about, shown on the row before a title exists. */
  host?: string;
  /** Where the conversation left off. Restoring navigates the active tab back here. */
  url?: string;
  /**
   * The Claude Code session this conversation lives in, so restoring can resume it. Only ever an id
   * the daemon confirmed (a `session` run event) — an unconfirmed one is not resumable, and passing
   * it would fail every run from here on.
   */
  claudeSessionId?: string;
  /** User messages, which is what "turn" means for the naming thresholds. */
  turns: number;
  /** The turn count the current title was generated from, so a title is never re-requested. */
  titledAtTurn?: number;
  /**
   * When a naming round-trip started, so a second one is not queued alongside it. A timestamp
   * rather than a flag because Chrome can stop the worker mid-request: a flag would then sit true
   * forever and this conversation would never be named again, where a stale timestamp is ignored.
   */
  namingAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Past this, a naming request is assumed dead rather than slow. Comfortably over its own timeout. */
export const NAMING_STALE_MS = 60_000;

/** True while a naming round-trip is plausibly still running. */
export const isNaming = (session: StoredSessionMeta): boolean =>
  session.namingAt !== undefined && Date.now() - session.namingAt < NAMING_STALE_MS;

export interface StoredSessionTranscript {
  id: string;
  items: RunItem[];
}

/** The session index, newest first, or an empty list when nothing is stored. */
export async function listSessions(): Promise<StoredSessionMeta[]> {
  const stored = await browser.storage.local.get(SESSIONS_INDEX_KEY);
  const list = stored[SESSIONS_INDEX_KEY];
  return Array.isArray(list) ? (list as StoredSessionMeta[]) : [];
}

async function writeIndex(list: StoredSessionMeta[]): Promise<void> {
  await browser.storage.local.set({ [SESSIONS_INDEX_KEY]: list });
}

/** What the panel owns and rewrites on every flush. The rest of the record is the worker's. */
export type SessionFields = Omit<StoredSessionMeta, 'title' | 'titledAtTurn' | 'namingAt'>;

/**
 * Write a conversation: its rows under their own key, its metadata at the head of the index.
 *
 * Merged rather than replaced, because two writers share this record: the panel rewrites the
 * fields above on every flush, while the worker writes the title alongside. A wholesale replace
 * would erase whichever one wrote second — in practice, the title, on the panel's next keystroke.
 *
 * An empty transcript is never stored. A panel opened and closed without a word said would
 * otherwise leave a blank row in the list every time.
 */
export async function putSession(fields: SessionFields, items: RunItem[]): Promise<void> {
  if (!items.length) return;
  const transcript: StoredSessionTranscript = { id: fields.id, items: items.slice(-MAX_ITEMS) };
  await browser.storage.local.set({ [transcriptKey(fields.id)]: transcript });

  const list = await listSessions();
  const existing = list.find((s) => s.id === fields.id);
  const kept = [{ ...existing, ...fields }, ...list.filter((s) => s.id !== fields.id)];
  // Bodies are keyed separately, so dropping a session from the index is not enough to reclaim
  // its space — the transcripts have to go explicitly, as in `skill-store.ts`.
  const dropped = kept.slice(MAX_SESSIONS);
  if (dropped.length) await browser.storage.local.remove(dropped.map((s) => transcriptKey(s.id)));
  await writeIndex(kept.slice(0, MAX_SESSIONS));
}

/** The rows of a saved conversation, or null when the id is unknown. */
export async function readTranscript(id: string): Promise<StoredSessionTranscript | null> {
  const key = transcriptKey(id);
  const stored = await browser.storage.local.get(key);
  const transcript = stored[key] as StoredSessionTranscript | undefined;
  return transcript && Array.isArray(transcript.items) ? transcript : null;
}

/**
 * Patch one session's metadata in place, leaving its transcript untouched. Silently does nothing
 * for an unknown id — a session trimmed off the tail while its naming round-trip was in flight
 * must not come back as a row with nothing behind it.
 */
export async function updateSessionMeta(id: string, patch: Partial<StoredSessionMeta>): Promise<void> {
  const list = await listSessions();
  if (!list.some((s) => s.id === id)) return;
  await writeIndex(list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

/** Remove a conversation and its transcript. */
export async function removeSession(id: string): Promise<void> {
  await browser.storage.local.remove(transcriptKey(id));
  const list = await listSessions();
  await writeIndex(list.filter((s) => s.id !== id));
}

/** A title is one line on a list row, so it is capped like one. Also clamped daemon-side. */
const MAX_TITLE_CHARS = 60;

/** How many of the user's messages to hand the namer. The recent ones say what it became about. */
const MAX_TITLE_MESSAGES = 12;

/**
 * The daemon round-trip that names a conversation: read its transcript, ask the daemon, and fold
 * the title back into the index. Called from the background worker (it owns the socket), so the
 * name lands even if the side panel that asked for it has since closed.
 *
 * Only the user's own messages are sent. An assistant turn restates whatever page it was reading,
 * so including one would let a site influence the name of a session in the user's own history.
 */
export async function nameStoredSession(sessionId: string): Promise<void> {
  const meta = (await listSessions()).find((s) => s.id === sessionId);
  if (!meta) return;
  const transcript = await readTranscript(sessionId);
  const messages = (transcript?.items ?? [])
    .filter((item): item is Extract<RunItem, { kind: 'user' }> => item.kind === 'user')
    .map((item) => item.text)
    .slice(-MAX_TITLE_MESSAGES);
  if (!messages.length) return;

  // Recorded before the round-trip so the row can show that a name is coming, and so a second
  // threshold crossing during a slow one does not queue a duplicate.
  const turns = meta.turns;
  await updateSessionMeta(sessionId, { namingAt: Date.now() });
  const result = await nameSession({ host: meta.host, messages });
  if (result.ok && result.data.title.trim()) {
    await updateSessionMeta(sessionId, {
      // Flattened and clamped again on this side: the daemon already does both, and neither end
      // should be the only thing standing between model output and a row in the user's history.
      title: result.data.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS),
      titledAtTurn: turns,
      namingAt: undefined,
    });
    return;
  }
  // A failed naming is not worth surfacing — the session is saved and usable without a name — but
  // the turn is marked so a daemon that is simply down does not get asked again on every run.
  await updateSessionMeta(sessionId, { titledAtTurn: turns, namingAt: undefined });
}

/** The turn count a name is owed for, or null when the current title is still current enough. */
export function titleDueAt(turns: number, titledAtTurn = 0): number | null {
  const crossed = TITLE_TURNS.filter((threshold) => turns >= threshold);
  const latest = crossed.at(-1);
  return latest !== undefined && latest > titledAtTurn ? latest : null;
}
