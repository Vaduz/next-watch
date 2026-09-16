/** **What the `tools` switch means.** Pure: a setting and the default list in, the list to watch
 *  out.
 *
 *  The switch grew a third form because the commonest thing a host wants to say about the tools
 *  section is not *which* CLIs to watch — the two defaults are the two there are — but whether
 *  the watcher may install a new release by itself. Saying that used to mean writing the whole
 *  default array out with `autoUpdate: false` on each entry, which is a copy of a list that then
 *  stops following the package's. `{ autoUpdate: false }` says the one thing and keeps the
 *  list. */

/** The object form: the default CLIs, with this said about updating them. */
export interface ToolsSetting {
  /** Whether the watcher installs a new release itself when one appears. Left out, each default
   *  keeps its own answer. */
  autoUpdate?: boolean;
}

/** What the object form is allowed to hold. An unknown key is a mistake worth a name: a config
 *  saying `autoupdate: false` and being obeyed as `true` is the failure this prevents. */
const KNOWN = new Set(['autoUpdate']);

/** Whether a value is the object form rather than a list of tools. */
function isSetting(switched: object): switched is ToolsSetting {
  return !Array.isArray(switched);
}

/** The tools to watch, or null when the section is off.
 *
 *  `where` names the setting in a complaint — the config file's path where one is in hand, the
 *  key itself otherwise. */
export function toolsIn<T extends { autoUpdate?: boolean }>(
  switched: boolean | ToolsSetting | readonly T[] | null | undefined,
  defaults: readonly T[],
  where: string,
): readonly T[] | null {
  if (switched === undefined || switched === false) return null;
  if (switched === true) return defaults;
  // ⚠️ `null` is in the parameter's type on purpose. A config file is JavaScript that
  // TypeScript never saw, and a value it says cannot arrive is exactly the one worth a message
  // naming the file rather than a `Cannot convert undefined or null to object` from below.
  if (typeof switched !== 'object' || switched === null) {
    throw new Error(`${where} must be true, false, an object, or an array`);
  }
  if (!isSetting(switched)) return switched;
  for (const key of Object.keys(switched)) {
    if (!KNOWN.has(key)) throw new Error(`${where}: unknown key ${key}`);
  }
  const { autoUpdate } = switched;
  if (autoUpdate === undefined) return defaults;
  if (typeof autoUpdate !== 'boolean') throw new Error(`${where}.autoUpdate must be true or false`);
  return defaults.map(tool => ({ ...tool, autoUpdate }));
}
