import { failure, isBridgeRequest, success } from '@/lib/actions/protocol';
import { describeActions } from '@/lib/actions/registry';
import { injectContentScript } from '@/lib/actions/client';
import { invokeForHarness } from '@/lib/bridge/invoke';
import { analyzeStoredFile } from '@/lib/bridge/file-store';
import { pushSkill, removeSkill, resyncSkills } from '@/lib/bridge/skill-store';
import { nameStoredSession } from '@/lib/bridge/session-store';
import { analyzeStoredRecording, resumePendingAnalyses } from '@/lib/bridge/recording-store';
import { appendEvents, recordingStateFor, serveRecorder } from '@/lib/bridge/recorder';
import { serveRunPorts } from '@/lib/bridge/run-port';
import { RECONNECT_ALARM, connectDaemon, disconnectDaemon, onWelcome, pairDaemon } from '@/lib/bridge/socket';

export default defineBackground(() => {
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
        'Expected {op:"describe"|"invoke"|"analyzeFile"|"saveSkill"|"removeSkill"|"nameSession"|"recordEvents"|"recordingState"|"analyzeRecording"|"pair"|"disconnect"}',
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

  serveRecorder();
  serveRunPorts();

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
