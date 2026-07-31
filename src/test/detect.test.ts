import assert from 'node:assert/strict';
import { describe as suite, test } from 'node:test';

import { outermostAppBundle } from '../notify/detect';

suite('outermostAppBundle', () => {
  test('returns the editor bundle, not the nested helper bundle', () => {
    const execPath =
      '/Applications/Visual Studio Code.app/Contents/Frameworks/' +
      'Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)';
    assert.equal(outermostAppBundle(execPath), '/Applications/Visual Studio Code.app');
  });

  test('works for VS Code forks without any change', () => {
    const execPath =
      '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/' +
      'Contents/MacOS/Cursor Helper (Plugin)';
    assert.equal(outermostAppBundle(execPath), '/Applications/Cursor.app');
  });

  test('handles a bundle outside /Applications', () => {
    const execPath = '/Users/me/Apps/VSCodium.app/Contents/MacOS/Electron';
    assert.equal(outermostAppBundle(execPath), '/Users/me/Apps/VSCodium.app');
  });

  test('returns undefined when nothing in the path is a bundle', () => {
    assert.equal(outermostAppBundle('/usr/local/bin/node'), undefined);
  });
});
