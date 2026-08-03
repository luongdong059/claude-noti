import * as vscode from 'vscode';

import { type NotificationContent, fitForModal } from './routing';

/**
 * Shows everything the notification banner had to leave out.
 *
 * A modal dialog does not scroll: give it enough text and it grows past the
 * bottom of the screen, taking its buttons with it, and there is then no way
 * to dismiss it. So the modal only ever holds an amount that is certain to
 * fit, and anything longer opens in an editor tab, which scrolls, can be
 * copied from, and closes like any other tab.
 */

const SCHEME = 'claude-noti';

const documents = new Map<string, string>();
let sequence = 0;

class DetailProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return documents.get(uri.path) ?? '';
  }
}

export function registerDetailView(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, new DetailProvider()),
  );
}

export async function showDetail(content: NotificationContent): Promise<void> {
  const detail = content.detail ?? content.message;
  const fitted = fitForModal(detail);
  const OPEN = 'Open full text';

  const choice = await vscode.window.showInformationMessage(
    content.subtitle,
    { modal: true, detail: fitted.text },
    ...(fitted.truncated ? [OPEN] : []),
  );

  if (choice === OPEN) {
    await openFullText(content, detail);
  }
}

async function openFullText(content: NotificationContent, detail: string): Promise<void> {
  // A fresh URI each time: content providers cache per URI, and reusing one
  // would show the previous notification's text.
  sequence += 1;
  const key = `/${sequence}-${safeName(content.title)}.txt`;
  documents.set(key, `${content.title}\n${content.subtitle}\n\n${detail}\n`);

  const uri = vscode.Uri.from({ scheme: SCHEME, path: key });
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
}

function safeName(title: string): string {
  return title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'details';
}
