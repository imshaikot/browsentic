import { failure, isBridgeRequest, success } from '@/lib/actions/protocol';
import { describeActions } from '@/lib/actions/registry';
import { injectContentScript } from '@/lib/actions/client';
import { invokeForHarness } from '@/lib/bridge/invoke';
import { serveDebuggerEvents } from '@/lib/bridge/cdp';
import { serveCodeToolkits } from '@/lib/bridge/code-toolkit';
import { serveDiagnostics } from '@/lib/bridge/diagnostics';
import { analyzeStoredFile } from '@/lib/bridge/file-store';
import { pushSkill, removeSkill, resyncSkills } from '@/lib/bridge/skill-store';
import { nameStoredSession } from '@/lib/bridge/session-store';
import { analyzeStoredRecording, resumePendingAnalyses } from '@/lib/bridge/recording-store';
import { ingestSample, monitorsForTab, serveMonitor } from '@/lib/bridge/monitor';
import { appendEvents, recordingStateFor, serveRecorder } from '@/lib/bridge/recorder';
import { closePanels, onPanelPresence, serveRunPorts, serveTabSessions } from '@/lib/bridge/run-port';
import { clearStrandedRail, serveRail, setPanelCollapsed, syncRail } from '@/lib/bridge/rail';
import { serveTimers } from '@/lib/bridge/timer';
import { closeSidebar, openSidePanel } from '@/lib/bridge/side-panel';
import { isAgentKind } from '@/lib/agents/catalog';
import {
  RECONNECT_ALARM,
  chooseAgent,
  chooseAgentModel,
  connectDaemon,
  disconnectDaemon,
  onWelcome,
  pairDaemon,
  readAgentState,
  readGuardrails,
  readSkillCatalog,
  setGuardrail,
  setUpAgent,
} from '@/lib/bridge/socket';

const OPEN_PANEL_MENU = 'open-side-panel';

export default defineBackground(() => {
  serveDebuggerEvents();

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    if (message.op === 'analyzeFile' && typeof message.fileId === 'string') {
      void analyzeStoredFile(message.fileId);
      sendResponse(success(true));
      return;
    }
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
    if (message.op === 'nameSession' && typeof message.sessionId === 'string') {
      void nameStoredSession(message.sessionId);
      sendResponse(success(true));
      return;
    }
    if (message.op === 'recordEvents' && Array.isArray(message.events)) {
      void appendEvents(sender.tab?.id, message.events);
      sendResponse(success(true));
      return;
    }
    if (message.op === 'recordingState') {
      recordingStateFor(sender.tab?.id)
        .then((state) => sendResponse(success(state)))
        .catch(() => sendResponse(success({ recording: false, captureValues: false })));
      return true;
    }
    if (message.op === 'analyzeRecording' && typeof message.recordingId === 'string') {
      void analyzeStoredRecording(message.recordingId);
      sendResponse(success(true));
      return;
    }
    if (message.op === 'monitorSample' && typeof message.monitorId === 'string') {
      void ingestSample(sender.tab?.id, message.monitorId, message.sample);
      sendResponse(success(true));
      return;
    }
    if (message.op === 'monitorState') {
      monitorsForTab(sender.tab?.id)
        .then(sendResponse)
        .catch(() => sendResponse(success({ monitors: [] })));
      return true;
    }
    if (message.op === 'listSkills') {
      readSkillCatalog(message.refresh === true)
        .then(sendResponse)
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'agentState') {
      readAgentState(message.refresh === true)
        .then(sendResponse)
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'setAgent' && isAgentKind(message.agent)) {
      chooseAgent(message.agent)
        .then(sendResponse)
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'setAgentModel' && isAgentKind(message.agent)) {
      chooseAgentModel(message.agent, typeof message.model === 'string' && message.model.trim() ? message.model : null)
        .then(sendResponse)
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'grantAgent' && isAgentKind(message.agent)) {
      setUpAgent(message.agent)
        .then(sendResponse)
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'guardrails') {
      readGuardrails()
        .then(sendResponse)
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'setGuardrail' && typeof message.setting === 'string') {
      setGuardrail(message.setting, message.value)
        .then(sendResponse)
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'pair' && typeof message.token === 'string') {
      pairDaemon(message.token)
        .then((result) =>
          sendResponse(result.ok ? success(true) : failure('PAIRING_FAILED', result.error ?? 'Pairing failed')),
        )
        .catch((error) => sendResponse(failure('BRIDGE_ERROR', String(error))));
      return true;
    }
    if (message.op === 'panelOpened') {
      void setPanelCollapsed(false);
      sendResponse(success(true));
      return;
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
        'Expected {op:"describe"|"invoke"|"analyzeFile"|"saveSkill"|"removeSkill"|"nameSession"|"recordEvents"|"recordingState"|"analyzeRecording"|"monitorSample"|"monitorState"|"listSkills"|"agentState"|"setAgent"|"setAgentModel"|"grantAgent"|"guardrails"|"setGuardrail"|"pair"|"panelOpened"|"disconnect"}',
      ),
    );
    return;
  });

  browser.runtime.onInstalled.addListener(() => {
    void browser.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id != null && !tab.discarded) void injectContentScript(tab.id);
      }
    });
  });

  const menuReady = browser.contextMenus
    .removeAll()
    .then(() =>
      browser.contextMenus.create({ id: OPEN_PANEL_MENU, title: 'Open Browsentic', contexts: ['all'] }),
    );

  let panelOpen = false;
  onPanelPresence((open) => {
    panelOpen = open;
    void menuReady.then(() =>
      browser.contextMenus.update(OPEN_PANEL_MENU, {
        title: open ? 'Close Browsentic' : 'Open Browsentic',
      }),
    );
    if (!open) void clearStrandedRail();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== OPEN_PANEL_MENU || tab?.windowId == null) return;
    if (panelOpen) {
      if (import.meta.env.FIREFOX) void closeSidebar();
      else closePanels();
      return;
    }
    void openSidePanel(tab.windowId);
  });

  serveDiagnostics();
  serveCodeToolkits();
  serveRecorder();
  serveMonitor();
  serveTimers();
  serveRunPorts();
  serveTabSessions();
  serveRail();
  void syncRail();

  onWelcome(() => {
    void resyncSkills();
    void resumePendingAnalyses();
  });

  void connectDaemon();
  browser.runtime.onStartup.addListener(() => void connectDaemon());

  browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void connectDaemon();
  });
});
