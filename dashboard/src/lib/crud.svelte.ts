import { errMsg } from "@btr-supply/shared/format";
import { refreshConfig, refreshCluster } from "./stores.svelte";

/** Shared CRUD state + operations for config editors */
export function createCrud<T>(opts: {
  save: (item: T) => Promise<unknown>;
  remove: (item: T) => Promise<unknown>;
  afterSave?: () => Promise<void>;
}) {
  const afterSave = opts.afterSave ?? refreshConfig;

  let editing = $state<T | null>(null);
  let opError = $state("");

  function startEdit(item: T) {
    editing = { ...item };
  }

  function startNew(template: T) {
    editing = { ...template };
  }

  function cancel() {
    editing = null;
  }

  async function save() {
    if (!editing) return;
    opError = "";
    try {
      await opts.save(editing);
      editing = null;
      await afterSave();
    } catch (e) {
      opError = errMsg(e);
    }
  }

  async function remove(item: T) {
    opError = "";
    try {
      await opts.remove(item);
      await afterSave();
    } catch (e) {
      opError = errMsg(e);
    }
  }

  return {
    get editing() { return editing; },
    set editing(v: T | null) { editing = v; },
    get opError() { return opError; },
    startEdit,
    startNew,
    cancel,
    save,
    remove,
  };
}

/** Shared busy/error action wrapper for worker & strategy controls */
export function createAction(afterAction: () => Promise<void> = refreshCluster) {
  let busy = $state(false);
  let error = $state("");

  async function run(fn: () => Promise<unknown>) {
    busy = true; error = "";
    try { await fn(); await afterAction(); }
    catch (e) { error = errMsg(e); }
    finally { busy = false; }
  }

  return {
    get busy() { return busy; },
    get error() { return error; },
    run,
  };
}
