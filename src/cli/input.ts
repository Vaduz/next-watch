/** **Reading keys.**
 *
 *  A thin adapter that copies readline's `keypress` into a `WatchKey` and hands it on. What a
 *  key does is decided by `core/watchInteraction.ts`, which is pure and checkable as a table.
 *
 *  ⚠️ Raw mode **does not use the alternate screen buffer**. A full-screen TUI was
 *  deliberately not built: the value of a watcher is the history left in the scrollback, and
 *  reading keys does not change that. Only the input side is touched.
 *
 *  ⚠️ In raw mode **Ctrl-C does not become SIGINT**, so the keypress is caught and acted on
 *  here — the banner promises "Ctrl-C to stop" and that has to hold.
 *
 *  ⚠️ The terminal is **always restored**. Leaving raw mode set makes the shell afterwards
 *  look broken, so it is restored from both `stop()` and `process.on('exit')`. */
import readline from 'node:readline';
import type { WatchKey } from '../core/watchInteraction.js';

/** The key readline hands over, with only what is needed. */
interface RawKey {
  name?: string;
  sequence?: string;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export class WatchInput {
  private started = false;
  private readonly onKeypress: (chunk: string, key: RawKey | undefined) => void;
  private readonly onExit: () => void;

  /** `handle` receives one keypress. **It must not throw**: a throw would leave the terminal
   *  in raw mode. */
  constructor(private readonly handle: (key: WatchKey) => void) {
    this.onKeypress = (chunk, key) => {
      // A keypress readline could not name — an ordinary character — arrives as the chunk.
      this.handle({
        name: key?.name,
        sequence: key?.sequence ?? chunk,
        shift: key?.shift,
        ctrl: key?.ctrl,
        meta: key?.meta,
      });
    };
    this.onExit = (): void => {
      this.restore();
    };
  }

  /** Only does anything on a TTY; a pipe receives no keys. */
  start(): boolean {
    if (this.started) return true;
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return false;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('keypress', this.onKeypress);
    process.on('exit', this.onExit);
    this.started = true;
    return true;
  }

  /** Put the terminal back. **Safe to call more than once**, since there are several ways to
   *  stop. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    process.stdin.off('keypress', this.onKeypress);
    process.off('exit', this.onExit);
    this.restore();
  }

  private restore(): void {
    const stdin = process.stdin;
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
    stdin.pause();
  }
}
