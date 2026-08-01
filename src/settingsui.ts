import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { CONFIG_SECTION } from './config';
import { log } from './log';

/**
 * Pickers for the three settings people actually want to change.
 *
 * All three are plain settings anyone can edit in settings.json, but none of
 * them are guessable: the sound is a bare macOS sound name, the icon is an
 * absolute path, and the timeout has one non-obvious value that matters most.
 * These commands turn each into a list you can choose from — and for sound,
 * one you can hear before committing to.
 */

/** Where macOS looks up a sound by name, in the order it searches. */
const SOUND_DIRECTORIES = [
  path.join(os.homedir(), 'Library', 'Sounds'),
  '/Library/Sounds',
  '/System/Library/Sounds',
];

interface SoundOption {
  name: string;
  file: string;
  source: string;
}

function availableSounds(): SoundOption[] {
  const byName = new Map<string, SoundOption>();
  // Later directories are the system ones; a user sound of the same name wins,
  // matching how macOS itself resolves them.
  for (const dir of SOUND_DIRECTORIES) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = path.basename(entry, path.extname(entry));
      if (!name || byName.has(name)) {
        continue;
      }
      byName.set(name, {
        name,
        file: path.join(dir, entry),
        source: dir.startsWith(os.homedir()) ? 'your sounds' : 'system',
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let preview: ChildProcess | undefined;

function play(file: string): void {
  stopPreview();
  try {
    preview = spawn('afplay', [file], { stdio: 'ignore' });
  } catch (err) {
    log.debug('could not preview sound', file, String(err));
  }
}

function stopPreview(): void {
  preview?.kill();
  preview = undefined;
}

async function update(key: string, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(key, value, vscode.ConfigurationTarget.Global);
}

interface SoundItem extends vscode.QuickPickItem {
  value: string;
  file?: string;
}

export async function chooseSound(): Promise<void> {
  const current = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('sound', '');

  const items: SoundItem[] = [
    { label: '$(mute) Silent', description: 'no sound', value: '' },
    { label: '$(bell) System default', description: 'whatever macOS is set to use', value: 'default' },
    ...availableSounds().map(
      (sound): SoundItem => ({
        label: `$(unmute) ${sound.name}`,
        description: sound.source,
        value: sound.name,
        file: sound.file,
      }),
    ),
  ];
  for (const item of items) {
    if (item.value === current) {
      item.description = `${item.description} — current`;
      item.picked = true;
    }
  }

  const picker = vscode.window.createQuickPick<SoundItem>();
  picker.items = items;
  picker.title = 'Claude Noti — notification sound';
  picker.placeholder = 'Move through the list to hear each one';
  picker.activeItems = items.filter((item) => item.value === current);

  // Playing on highlight rather than on selection is the whole point: you
  // cannot pick a sound sensibly from a list of names alone.
  picker.onDidChangeActive((active) => {
    const file = active[0]?.file;
    if (file) {
      play(file);
    } else {
      stopPreview();
    }
  });

  const chosen = await new Promise<SoundItem | undefined>((resolve) => {
    picker.onDidAccept(() => resolve(picker.selectedItems[0]));
    picker.onDidHide(() => resolve(undefined));
    picker.show();
  });
  picker.dispose();
  stopPreview();

  if (!chosen) {
    return;
  }
  await update('sound', chosen.value);
  void vscode.window.showInformationMessage(
    chosen.value ? `Notification sound set to ${chosen.value}.` : 'Notifications are now silent.',
  );
}

export async function chooseIcon(): Promise<void> {
  const BUNDLED = 'The extension’s bell icon';
  const SENDER = 'Terminal’s icon';
  const BROWSE = 'Choose an image…';

  const choice = await vscode.window.showQuickPick(
    [
      { label: `$(bell) ${BUNDLED}`, description: 'default', value: '' },
      { label: `$(terminal) ${SENDER}`, description: 'no override', value: 'none' },
      { label: `$(file-media) ${BROWSE}`, description: 'png or jpg', value: 'browse' },
    ],
    { title: 'Claude Noti — notification icon', placeHolder: 'Shown on the notification banner' },
  );
  if (!choice) {
    return;
  }

  if (choice.value !== 'browse') {
    await update('notificationIcon', choice.value);
    void vscode.window.showInformationMessage(
      choice.value === 'none'
        ? 'Notifications will use Terminal’s icon.'
        : 'Notifications will use the extension’s icon.',
    );
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Use this image',
    filters: { Images: ['png', 'jpg', 'jpeg'] },
  });
  const file = picked?.[0];
  if (!file) {
    return;
  }
  await update('notificationIcon', file.fsPath);
  void vscode.window.showInformationMessage(`Notification icon set to ${path.basename(file.fsPath)}.`);
}

export async function chooseTimeout(): Promise<void> {
  const CUSTOM = -1;
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: '$(clock) Wait until I act on it',
        description: 'recommended',
        detail: 'The notification stays on screen — which is the point when you have stepped away.',
        value: 0,
      },
      { label: '30 seconds', value: 30 },
      { label: '2 minutes', value: 120 },
      { label: '10 minutes', value: 600 },
      { label: '$(edit) Custom…', description: 'enter a number of seconds', value: CUSTOM },
    ],
    { title: 'Claude Noti — how long the notification stays', placeHolder: 'Auto-close after…' },
  );
  if (!choice) {
    return;
  }

  let seconds = choice.value;
  if (seconds === CUSTOM) {
    const entered = await vscode.window.showInputBox({
      title: 'Auto-close after how many seconds?',
      value: '60',
      validateInput: (raw) => {
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 ? undefined : 'Enter a whole number of seconds, 0 or more.';
      },
    });
    if (entered === undefined) {
      return;
    }
    seconds = Number(entered);
  }

  await update('timeoutSeconds', seconds);
  void vscode.window.showInformationMessage(
    seconds === 0
      ? 'Notifications will wait until you act on them.'
      : `Notifications will close after ${seconds} seconds.`,
  );
}

export function disposeSettingsUi(): void {
  stopPreview();
}
