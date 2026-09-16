import { describe, expect, it } from 'bun:test';
import { serverKillSet } from './killSet.js';
import type { ProcInfo } from './ps.js';

/** A shorthand row: pid, ppid, sid, and what it is. */
function row(pid: number, ppid: number, sid: number | undefined, command: string): ProcInfo {
  return sid === undefined ? { pid, ppid, command } : { pid, ppid, pgid: sid, sid, command };
}

describe('serverKillSet', () => {
  const cases: {
    name: string;
    procs: ProcInfo[];
    pid: number;
    pids: number[];
    leaving: { pid: number; command: string }[];
    by: 'sid' | 'pgid' | null;
  }[] = [
    {
      name: 'a plain tree, all in the server session',
      procs: [
        row(100, 1, 100, 'bun run dev'),
        row(101, 100, 100, 'next-server'),
        row(102, 101, 100, 'esbuild --service'),
        row(200, 1, 200, 'somebody else'),
      ],
      pid: 100,
      pids: [100, 101, 102],
      leaving: [],
      by: 'sid',
    },
    {
      // ⚠️ The row this exists for: a job the server started with `detached: true`, six minutes
      // into an LLM call, and its own child.
      name: 'a detached job and its child are left running',
      procs: [
        row(100, 1, 100, 'bun run dev'),
        row(101, 100, 100, 'next-server'),
        row(300, 100, 300, 'bun run write-article'),
        row(301, 300, 300, 'claude -p write'),
      ],
      pid: 100,
      pids: [100, 101],
      leaving: [{ pid: 300, command: 'bun run write-article' }],
      by: 'sid',
    },
    {
      name: 'only the top of a left-behind subtree is named',
      procs: [
        row(100, 1, 100, 'bun run dev'),
        row(300, 100, 300, 'bun run write-article'),
        row(301, 300, 300, 'claude -p write'),
        row(302, 301, 300, 'node fetch'),
      ],
      pid: 100,
      pids: [100],
      leaving: [{ pid: 300, command: 'bun run write-article' }],
      by: 'sid',
    },
    {
      name: 'two separate detached jobs are two lines',
      procs: [
        row(100, 1, 100, 'bun run dev'),
        row(300, 100, 300, 'bun run write-article'),
        row(400, 100, 400, 'bun run build-index'),
      ],
      pid: 100,
      pids: [100],
      leaving: [
        { pid: 300, command: 'bun run write-article' },
        { pid: 400, command: 'bun run build-index' },
      ],
      by: 'sid',
    },
    {
      name: 'a ps without sid falls back to the process group',
      procs: [
        { pid: 100, ppid: 1, pgid: 100, command: 'bun run dev' },
        { pid: 101, ppid: 100, pgid: 100, command: 'next-server' },
        { pid: 300, ppid: 100, pgid: 300, command: 'bun run write-article' },
      ],
      pid: 100,
      pids: [100, 101],
      leaving: [{ pid: 300, command: 'bun run write-article' }],
      by: 'pgid',
    },
    {
      name: 'a ps with neither stops the whole tree, as it did before',
      procs: [
        { pid: 100, ppid: 1, command: 'bun run dev' },
        { pid: 101, ppid: 100, command: 'next-server' },
        { pid: 300, ppid: 100, command: 'bun run write-article' },
      ],
      pid: 100,
      pids: [100, 101, 300],
      leaving: [],
      by: null,
    },
    {
      name: 'a server the snapshot does not know stops whatever tree there is',
      procs: [row(200, 1, 200, 'somebody else')],
      pid: 100,
      pids: [100],
      leaving: [],
      by: null,
    },
    {
      // Not knowing is not proof that it is somebody else's, and a descendant left behind by
      // mistake goes on holding the port.
      name: 'a descendant with no session of its own is stopped',
      procs: [row(100, 1, 100, 'bun run dev'), { pid: 101, ppid: 100, command: 'next-server' }],
      pid: 100,
      pids: [100, 101],
      leaving: [],
      by: 'sid',
    },
    {
      // A server started under `setsid` is its own session leader; everything it forks is in it.
      name: 'a server that is its own session leader keeps its children',
      procs: [row(100, 1, 100, 'next-watch server'), row(101, 100, 100, 'next dev'), row(102, 101, 100, 'swc')],
      pid: 100,
      pids: [100, 101, 102],
      leaving: [],
      by: 'sid',
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(serverKillSet(c.procs, c.pid)).toEqual({ pids: c.pids, leaving: c.leaving, by: c.by });
    });
  }
});
