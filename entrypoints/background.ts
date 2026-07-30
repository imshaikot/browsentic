import { failure, isBridgeRequest, success } from '@/lib/actions/protocol';
import { describeActions } from '@/lib/actions/registry';
import { injectContentScript } from '@/lib/actions/client';
import { invokeForHarness } from '@/lib/bridge/invoke';
import { analyzeStoredFile } from '@/lib/bridge/file-store';
import { pushSkill, removeSkill, resyncSkills } from '@/lib/bridge/skill-store';
import { nameStoredSession } from '@/lib/bridge/session-store';
import { serveRunPorts } from '@/lib/bridge/run-port';
import { RECONNECT_ALARM, connectDaemon, disconnectDaemon, onWelcome, pairDaemon } from '@/lib/bridge/socket';

export default defineBackground(() => {
  // Action bridge for extension pages (the side panel).
  // 'describe' lists every action as an MCP-ready tool; 'invoke' routes one to the active tab.
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBridgeRequest(message)) return;
    if (message.op === 'describe') {
      sendResponse(success(describeActions()));
      return;
    }
    if (message.op === 'invoke' && typeof message.action === 'string') {
      invokeForHarness(message.action, message.input)
        .then(sendResponse)
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    // Summarize a stored file. Fire-and-forget: the helper reads the bytes, runs the daemon
    // round-trip, and writes the summary/status back to the file index, which the side panel
    // observes via storage.onChanged — so it lands even if the panel that asked has closed.
    // The daemon's own keepalive pings hold the worker alive across the round-trip.
    if (message.op === 'analyzeFile' && typeof message.fileId === 'string') {
      void analyzeStoredFile(message.fileId);
      sendResponse(success(true));
      return;
    }
    // Push an uploaded skill to the daemon's skills directory, or take it back off. Same
    // fire-and-forget shape as analyzeFile — the worker reads the body from storage itself and
    // writes the sync status back to the index, so the panel need not stay open for it.
    if (message.op === 'saveSkill' && typeof message.skillId === 'string') {
      void pushSkill(message.skillId);
      sendResponse(success(true));
      return;
    }
    if (message.op === 'removeSkill' && typeof message.skillId === 'string') {
      void removeSkill(message.skillId);
      sendResponse(success(true));
      return;
    }
    // Name a saved conversation. Same fire-and-forget shape again: the worker reads the transcript
    // from storage and writes the title back to the session index, so the name arrives even if the
    // panel that crossed the turn threshold has since been closed.
    if (message.op === 'nameSession' && typeof message.sessionId === 'string') {
      void nameStoredSession(message.sessionId);
      sendResponse(success(true));
      return;
    }
    // Pairing is driven from the popup: the worker owns the socket, the UI just asks.
    if (message.op === 'pair' && typeof message.token === 'string') {
      pairDaemon(message.token)
        .then((result) =>
          sendResponse(result.ok ? success(true) : failure('PAIRING_FAILED', result.error ?? 'Pairing failed')),
        )
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'disconnect') {
      disconnectDaemon()
        .then(() => sendResponse(success(true)))
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    sendResponse(
      failure(
        'INVALID_REQUEST',
        'Expected {op:"describe"|"invoke"|"analyzeFile"|"saveSkill"|"removeSkill"|"nameSession"|"pair"|"disconnect"}',
      ),
    );
    return;
  });

  // Declared content scripts only load with a page, so tabs that were open before this
  // extension version loaded have no listener in them and every action would fail with
  // TAB_UNREACHABLE. Re-inject on install and update; pages that refuse (chrome://, the Web
  // Store) fail injection quietly and stay unreachable, which is correct.
  browser.runtime.onInstalled.addListener(() => {
    void browser.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id != null && !tab.discarded) void injectContentScript(tab.id);
      }
    });
  });

  // Free-text instructions from the popup and side panel, and the run events that come back.
  // A port rather than sendMessage, because assistant text streams in token by token.
  serveRunPorts();

  // A skill uploaded while the daemon was down never reached disk. Push those, and only those,
  // once it is back — re-pushing everything would rewrite every file on every reconnect.
  onWelcome(() => void resyncSkills());

  // The same actions, reached from outside the browser by the local MCP daemon — but only
  // once the user has paired this browser. An unpaired extension never dials out.
  void connectDaemon();
  browser.runtime.onStartup.addListener(() => void connectDaemon());

  // Chrome stops an idle worker after 30s. Daemon pings keep it alive while connected;
  // this alarm is the only thing that can revive it once it has been torn down.
  browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void connectDaemon();
  });
});
