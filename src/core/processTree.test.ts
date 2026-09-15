// Walking down the process tree, which is what stopping a spawned server means: `npm run dev`
// is the parent of the process that holds the port, so a stop that only signals the pid it
// spawned leaves the port taken and the next start fails.
import { describe, expect, it } from 'bun:test';
import { processTree, type ProcInfo } from './ps.js';

const proc = (pid: number, ppid: number, command = 'x'): ProcInfo => ({ pid, ppid, command });

describe('processTree', () => {
  // The shape a spawned dev server actually makes: the watcher, the package manager it ran, the
  // framework binary under that, and an unrelated process that must not be touched.
  const tree: ProcInfo[] = [
    proc(1, 0, 'init'),
    proc(100, 1, 'next-watch'),
    proc(200, 100, 'npm run dev'),
    proc(300, 200, 'next dev'),
    proc(301, 200, 'next-server'),
    proc(400, 300, 'esbuild'),
    proc(900, 1, 'something else'),
  ];

  const cases: [name: string, procs: ProcInfo[], pid: number, expected: number[]][] = [
    ['the whole tree under a package manager, parents first', tree, 200, [200, 300, 301, 400]],
    ['a leaf is only itself', tree, 400, [400]],
    ['an unrelated process stays unrelated', tree, 900, [900]],
    // The `ps` snapshot could not be read. Stopping one process must not become stopping none.
    ['a pid the snapshot knows nothing about', [], 200, [200]],
    ['a pid missing from a snapshot that has other rows', tree, 555, [555]],
    // `ps` is sampled, not locked: rows can disappear or contradict each other between reads.
    ['a cycle does not hang', [proc(10, 11), proc(11, 10)], 10, [10, 11]],
    ['a process that is its own parent', [proc(7, 7)], 7, [7]],
    ['pid 0 is not a process', tree, 0, []],
  ];

  for (const [name, procs, pid, expected] of cases) {
    it(name, () => {
      expect(processTree(procs, pid)).toEqual(expected);
    });
  }
});
