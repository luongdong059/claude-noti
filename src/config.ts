import * as vscode from 'vscode';

import type { HookScope } from './hooks/installer';
import type { EventPolicy } from './routing';

export interface Settings {
  enabled: boolean;
  events: EventPolicy;
  suppressWhenFocused: boolean;
  notifierPath: string;
  impersonateEditor: boolean;
  sound: string;
  timeoutSeconds: number;
  minIntervalMs: number;
  notifyUnmatchedSessions: boolean;
  onFocusCommands: string[];
  hookScope: HookScope;
}

export const CONFIG_SECTION = 'claudeNoti';

export function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    enabled: config.get('enabled', true),
    events: {
      permissionPrompt: config.get('events.permissionPrompt', true),
      idlePrompt: config.get('events.idlePrompt', true),
      agentNeedsInput: config.get('events.agentNeedsInput', true),
      stop: config.get('events.stop', true),
    },
    suppressWhenFocused: config.get('suppressWhenFocused', true),
    notifierPath: config.get('notifierPath', '').trim(),
    impersonateEditor: config.get('impersonateEditor', false),
    sound: config.get('sound', '').trim(),
    timeoutSeconds: Math.max(0, config.get('timeoutSeconds', 0)),
    minIntervalMs: Math.max(0, config.get('minIntervalMs', 1500)),
    notifyUnmatchedSessions: config.get('notifyUnmatchedSessions', false),
    onFocusCommands: config.get('onFocusCommands', []),
    hookScope: config.get<string>('hookScope', 'user') === 'project' ? 'project' : 'user',
  };
}
