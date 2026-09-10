import { describe, expect, it } from 'bun:test';
import {
  applyKey,
  initialUi,
  scrollPane,
  toggleFocus,
  visibleFlash,
  FLASH_TTL_MS,
  type WatchKey,
  type WatchUi,
} from './watchInteraction.js';
import type { WatchTarget } from './watchTargets.js';

const TARGETS: WatchTarget[] = [
  { key: 'server:web', kind: 'server', id: 'web', verbs: ['restart', 'stop'] },
  { key: 'server:admin', kind: 'server', id: 'admin', verbs: ['start'] },
  { key: 'pane:event', kind: 'pane', id: 'event', verbs: ['focus'] },
  { key: 'pane:admin', kind: 'pane', id: 'admin', verbs: ['focus'] },
  { key: 'pane:web', kind: 'pane', id: 'web', verbs: ['focus'] },
];

const CTX = { targets: TARGETS, scrollMax: { event: 30, admin: 5, web: 0 } };

/** One key, in the shape readline hands over. */
const key = (over: Partial<WatchKey>): WatchKey => ({ ...over });
const char = (c: string): WatchKey => ({ sequence: c });

/** The state after pressing a sequence of keys. */
function press(start: WatchUi, keys: readonly WatchKey[]): WatchUi {
  return keys.reduce((ui, k) => applyKey(ui, k, CTX).ui, start);
}

describe('applyKey: the cursor', () => {
  it('moves forward on Tab and back on Shift-Tab', () => {
    const one = applyKey(initialUi(), key({ name: 'tab' }), CTX);
    expect(one.ui.selected).toBe('server:web');
    expect(one.action.kind).toBe('redraw');
    expect(applyKey(one.ui, key({ name: 'tab' }), CTX).ui.selected).toBe('server:admin');
    expect(applyKey(one.ui, key({ name: 'tab', shift: true }), CTX).ui.selected).toBe('pane:web');
  });

  it('closes what is open outermost first: the command line, then the selection', () => {
    const typing = press(initialUi(), [key({ name: 'tab' }), char('x')]);
    expect(typing.input).toBe('x');
    const closed = applyKey(typing, key({ name: 'escape' }), CTX).ui;
    expect(closed.input).toBeNull();
    expect(closed.selected).toBe('server:web');
    expect(applyKey(closed, key({ name: 'escape' }), CTX).ui.selected).toBeNull();
  });
});

describe('applyKey: scrolling', () => {
  it('scrolls the event pane by default', () => {
    const up = applyKey(initialUi(), key({ name: 'up' }), CTX).ui;
    expect(up.scroll.event).toBe(1);
    expect(applyKey(up, key({ name: 'down' }), CTX).ui.scroll.event).toBe(0);
  });

  it('scrolls the selected pane instead when one is selected', () => {
    const onAdminPane = press(
      initialUi(),
      Array.from({ length: 4 }, () => key({ name: 'tab' })),
    );
    expect(scrollPane(onAdminPane, TARGETS)).toBe('admin');
    const scrolled = applyKey(onAdminPane, key({ name: 'up' }), CTX).ui;
    expect(scrolled.scroll.admin).toBe(1);
    expect(scrolled.scroll.event).toBe(0);
  });

  it('stops at the scroll limit, and does not go past the end either', () => {
    const far = press(
      initialUi(),
      Array.from({ length: 50 }, () => key({ name: 'pageup' })),
    );
    expect(far.scroll.event).toBe(30);
    const back = press(
      far,
      Array.from({ length: 50 }, () => key({ name: 'pagedown' })),
    );
    expect(back.scroll.event).toBe(0);
  });

  it('does not move a pane whose rows all fit', () => {
    const onWebPane = { ...initialUi(), selected: 'pane:web', index: 0 };
    const ctx = {
      targets: [...TARGETS, { key: 'pane:web', kind: 'pane' as const, id: 'web', verbs: [] }],
      scrollMax: CTX.scrollMax,
    };
    // The scroll map is sparse now that the panes are dynamic: a pane that has never moved
    // gets no entry at all, which is the same thing as being at the end.
    expect(applyKey(onWebPane, key({ name: 'up' }), ctx).ui.scroll).toEqual(onWebPane.scroll);
  });
});

describe('applyKey: running a verb from its initial', () => {
  const onWeb = (): WatchUi => press(initialUi(), [key({ name: 'tab' })]);

  it('runs the verb at once when its initial is pressed', () => {
    const out = applyKey(onWeb(), char('r'), CTX);
    expect(out.action).toEqual({ kind: 'submit', line: 'restart' });
    expect(out.ui.input).toBeNull();
  });

  it('sends an initial the target lacks to the command line rather than running something else', () => {
    const onAdmin = press(initialUi(), [key({ name: 'tab' }), key({ name: 'tab' })]);
    const out = applyKey(onAdmin, char('r'), CTX);
    expect(out.action.kind).toBe('redraw');
    expect(out.ui.input).toBe('r');
  });

  it('accepts help and quit with nothing selected', () => {
    expect(applyKey(initialUi(), char('q'), CTX).action).toEqual({ kind: 'submit', line: 'quit' });
    expect(applyKey(initialUi(), char('h'), CTX).action).toEqual({ kind: 'submit', line: 'help' });
  });

  it('ignores initials while the command line is open, so nothing starts mid-word', () => {
    const typing = press(onWeb(), [char(':')]);
    const out = applyKey(typing, char('r'), CTX);
    expect(out.action.kind).toBe('redraw');
    expect(out.ui.input).toBe('r');
  });

  it('opens the command line on ":" without typing it, for spelling a verb out', () => {
    const out = applyKey(onWeb(), char(':'), CTX);
    expect(out.ui.input).toBe('');
    expect(out.action.kind).toBe('redraw');
  });
});

describe('applyKey: the command line', () => {
  it('opens the command line on a character that is not an initial', () => {
    const ui = press(initialUi(), [char('x'), char('y')]);
    expect(ui.input).toBe('xy');
  });

  it('erases one character on Backspace, staying open when it empties', () => {
    const ui = press(initialUi(), [char('x'), key({ name: 'backspace' }), key({ name: 'backspace' })]);
    expect(ui.input).toBe('');
  });

  it('runs the typed line on Enter and closes the command line', () => {
    const typing = press(initialUi(), [char(':'), char('s'), char('t'), char('o'), char('p')]);
    const done = applyKey(typing, key({ name: 'return' }), CTX);
    expect(done.action).toEqual({ kind: 'submit', line: 'stop' });
    expect(done.ui.input).toBeNull();
  });

  it('does nothing on Enter with the command line closed', () => {
    expect(applyKey(initialUi(), key({ name: 'return' }), CTX).action.kind).toBe('none');
  });

  it('clears the last result on the next key, leaving nothing stuck on screen', () => {
    const withStatus: WatchUi = { ...initialUi(), status: 'nothing selected' };
    expect(applyKey(withStatus, key({ name: 'tab' }), CTX).ui.status).toBeNull();
  });
});

describe('applyKey: stopping, and keys it ignores', () => {
  it('stops on Ctrl-C, which raw mode never turns into SIGINT', () => {
    expect(applyKey(initialUi(), key({ name: 'c', ctrl: true }), CTX).action.kind).toBe('quit');
  });

  it('keeps control characters and modified keys out of the command line', () => {
    for (const k of [key({ name: 'f5' }), key({ ctrl: true, sequence: 'a' }), key({ meta: true, sequence: 'b' })]) {
      const out = applyKey(initialUi(), k, CTX);
      expect(out.ui.input).toBeNull();
      expect(out.action.kind).toBe('none');
    }
  });
});

describe('toggleFocus', () => {
  it('toggles, going back on a second press', () => {
    const on = toggleFocus(initialUi(), 'web');
    expect(on.focus).toBe('web');
    expect(toggleFocus(on, 'web').focus).toBeNull();
  });

  it('moves to another pane when that one is named', () => {
    expect(toggleFocus(toggleFocus(initialUi(), 'web'), 'event').focus).toBe('event');
  });

  it('leaves the cursor on that pane, so going back continues from there', () => {
    expect(toggleFocus(initialUi(), 'admin').selected).toBe('pane:admin');
  });

  it('cycles Tab through the panes alone while one fills the frame', () => {
    const focused = toggleFocus(initialUi(), 'event');
    const next = applyKey(focused, key({ name: 'tab' }), CTX).ui;
    expect(next.selected).toBe('pane:admin');
    expect(applyKey(next, key({ name: 'tab' }), CTX).ui.selected).toBe('pane:web');
    // The ends wrap, and never reach the servers.
    const last = { ...next, selected: 'pane:web', index: 2 };
    expect(applyKey(last, key({ name: 'tab' }), CTX).ui.selected).toBe('pane:event');
  });

  it('closes the command line, then the focus, then the selection', () => {
    const typing = { ...toggleFocus(initialUi(), 'web'), input: 'x' };
    const closed = applyKey(typing, key({ name: 'escape' }), CTX).ui;
    expect(closed.input).toBeNull();
    expect(closed.focus).toBe('web');
    const unfocused = applyKey(closed, key({ name: 'escape' }), CTX).ui;
    expect(unfocused.focus).toBeNull();
    expect(unfocused.selected).toBe('pane:web');
    expect(applyKey(unfocused, key({ name: 'escape' }), CTX).ui.selected).toBeNull();
  });

  it('sends f through as a command, focusing being a verb like any other', () => {
    const onPane = { ...initialUi(), selected: 'pane:event', index: 2 };
    expect(applyKey(onPane, char('f'), CTX).action).toEqual({ kind: 'submit', line: 'focus' });
  });
});

describe("a finished action's result", () => {
  const NOW = 1_700_000_000_000;
  const done = (atMs: number): WatchUi => ({
    ...initialUi(),
    flash: { text: 'update codex done 3.1s', ok: true, atMs },
  });

  it('shows for a while after it finishes', () => {
    expect(visibleFlash(done(NOW), NOW)).toEqual({ text: 'update codex done 3.1s', ok: true });
    expect(visibleFlash(done(NOW), NOW + FLASH_TTL_MS - 1)).not.toBeNull();
  });

  it('stops showing once its time is up, and the controls return', () => {
    expect(visibleFlash(done(NOW), NOW + FLASH_TTL_MS)).toBeNull();
    expect(visibleFlash(done(NOW), NOW + FLASH_TTL_MS * 10)).toBeNull();
  });

  it('shows nothing when nothing has finished', () => {
    expect(visibleFlash(initialUi(), NOW)).toBeNull();
  });

  it('survives a keypress, or it would vanish before it could be read', () => {
    const after = press(done(NOW), [key({ name: 'tab' }), char('x'), key({ name: 'down' })]);
    expect(visibleFlash(after, NOW)).not.toBeNull();
  });

  it('clears on Esc, which is the way to get the controls back at once', () => {
    expect(applyKey(done(NOW), key({ name: 'escape' }), CTX).ui.flash).toBeNull();
  });

  it('survives the Esc that only closes the command line, never having been on screen', () => {
    const typing = { ...done(NOW), input: 'rest' };
    const closed = applyKey(typing, key({ name: 'escape' }), CTX).ui;
    expect(closed.input).toBeNull();
    expect(visibleFlash(closed, NOW)).not.toBeNull();
  });
});
