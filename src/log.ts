/**
 * Logging with no `vscode` import, so that everything which logs stays
 * testable under plain Node. The extension installs an output-channel sink at
 * activation; until then, and in tests, log calls are no-ops.
 */
export interface LogSink {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  show?(): void;
}

let sink: LogSink | undefined;

export function setLogSink(next: LogSink | undefined): void {
  sink = next;
}

function fmt(args: unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export const log = {
  debug: (...args: unknown[]) => sink?.debug(fmt(args)),
  info: (...args: unknown[]) => sink?.info(fmt(args)),
  warn: (...args: unknown[]) => sink?.warn(fmt(args)),
  error: (...args: unknown[]) => sink?.error(fmt(args)),
  show: () => sink?.show?.(),
};
