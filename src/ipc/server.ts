import * as fs from 'node:fs';
import * as http from 'node:http';

import { log } from '../log';
import { type HookEvent, parseHookEvent } from '../hooks/payload';
import { socketPath, socketPathTooLong } from '../paths';
import { ensureDirs } from './registry';

/** A hook payload is a few hundred bytes; anything far larger is not ours. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * An HTTP server bound to a Unix domain socket rather than a TCP port. The
 * socket lives in a 0700 directory under $HOME, so the OS enforces that only
 * this user can reach it — no port to firewall, nothing exposed to the network.
 */
export class IpcServer {
  private server: http.Server | undefined;
  private readonly path: string;

  constructor(
    private readonly pid: number,
    private readonly onEvent: (event: HookEvent) => void,
    /**
     * Live state reported by `/ping`. Whether a window considers itself
     * focused decides whether it notifies at all, and that is invisible from
     * outside the extension host — which makes "why did nothing happen?"
     * impossible to answer without exposing it here.
     */
    private readonly status: () => Record<string, unknown> = () => ({}),
  ) {
    this.path = socketPath(pid);
  }

  get socketPath(): string {
    return this.path;
  }

  async start(): Promise<void> {
    ensureDirs();

    if (socketPathTooLong(this.path)) {
      throw new Error(
        `socket path exceeds the macOS limit of 103 bytes: ${this.path}. ` +
          'Claude Noti cannot listen for hook events.',
      );
    }

    // A previous process may have died without cleaning up. Binding over a
    // leftover file fails with EADDRINUSE, so remove it first.
    try {
      fs.unlinkSync(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.path, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    // Only the owner may talk to us, belt and braces alongside the 0700 dir.
    try {
      fs.chmodSync(this.path, 0o600);
    } catch (err) {
      log.warn('could not chmod socket', this.path, String(err));
    }

    server.on('error', (err) => log.error('ipc server error', String(err)));
    log.info('listening on', this.path);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && req.url === '/ping') {
      respond(res, 200, { ok: true, pid: this.pid, ...this.status() });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/notify') {
      respond(res, 404, { ok: false });
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        respond(res, 413, { ok: false });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) {
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const event = parseHookEvent(raw);
      if (!event) {
        log.warn('discarded unparseable hook payload');
        respond(res, 400, { ok: false });
        return;
      }
      // Answer before doing the work: the hook script waits on this request,
      // and Claude Code waits on the hook script.
      respond(res, 200, { ok: true });
      try {
        this.onEvent(event);
      } catch (err) {
        log.error('event handler threw', String(err));
      }
    });

    req.on('error', (err) => log.warn('request error', String(err)));
  }

  dispose(): void {
    this.server?.close();
    this.server = undefined;
    try {
      fs.unlinkSync(this.path);
    } catch {
      // Already gone, or never created.
    }
  }
}

function respond(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
