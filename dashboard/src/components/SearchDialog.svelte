<script lang="ts">
  import type MiniSearch from "minisearch";
  import { searchDocs, type DocPage } from "$lib/docs";
  import { TEXT } from "$lib/theme";

  interface Props {
    searchIndex: MiniSearch<DocPage>;
    onSelect: (id: string) => void;
  }

  let { searchIndex, onSelect }: Props = $props();

  let dialogEl: HTMLDialogElement;
  let query = $state("");
  let results = $derived(searchDocs(searchIndex, query));
  let selectedIdx = $state(0);

  $effect(() => { results; selectedIdx = 0; });

  export function open() {
    query = "";
    dialogEl?.showModal();
  }

  function close() {
    dialogEl?.close();
  }

  function pick(id: string) {
    close();
    onSelect(id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, results.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
    } else if (e.key === "Enter" && results[selectedIdx]) {
      pick(results[selectedIdx].id);
    }
  }
</script>

<svelte:window onkeydown={(e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "/")) {
    e.preventDefault();
    open();
  }
}} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="bg-transparent backdrop:bg-black/60 p-0 max-w-lg w-full"
  onkeydown={handleKeydown}
  onclick={(e) => { if (e.target === dialogEl) close(); }}
>
  <div class="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
    <div class="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
      <span class="{TEXT.label} text-sm">Search docs</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={query}
        placeholder="Type to search..."
        class="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder-zinc-600"
        autofocus
      />
      <kbd class="text-[10px] {TEXT.dim} border border-zinc-700 rounded px-1.5 py-0.5">ESC</kbd>
    </div>

    {#if results.length > 0}
      <ul class="max-h-72 overflow-y-auto py-1">
        {#each results as result, i}
          <li>
            <button
              class="w-full text-left px-4 py-2 text-xs flex items-center gap-2 transition-colors
                {i === selectedIdx ? 'bg-zinc-800 text-zinc-100' : TEXT.secondary + ' hover:bg-zinc-800/50'}"
              onclick={() => pick(result.id)}
            >
              <span class="font-medium">{result.title}</span>
              <span class="{TEXT.dim} text-[10px]">{result.id}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if query.length >= 2}
      <div class="px-4 py-6 text-center text-xs {TEXT.dim}">No results for &ldquo;{query}&rdquo;</div>
    {:else}
      <div class="px-4 py-6 text-center text-xs {TEXT.dim}">Start typing to search documentation</div>
    {/if}
  </div>
</dialog>
