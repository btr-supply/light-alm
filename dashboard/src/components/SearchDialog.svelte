<script lang="ts">
  import { getSearchIndex, searchDocs } from "$lib/docs";

  interface Props {
    onSelect: (id: string) => void;
  }

  let { onSelect }: Props = $props();

  let dialogEl: HTMLDialogElement;
  let query = $state("");
  let searchIdx = $state<Awaited<ReturnType<typeof getSearchIndex>> | null>(null);
  let results = $derived(searchIdx ? searchDocs(searchIdx, query) : []);
  let selectedIdx = $state(0);

  $effect(() => { results; selectedIdx = 0; });

  export async function open() {
    query = "";
    dialogEl?.showModal();
    if (!searchIdx) searchIdx = await getSearchIndex();
  }

  function close() {
    dialogEl?.close();
  }

  function pick(id: string) {
    close();
    onSelect(id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, results.length - 1);
    } else if (e.key === "ArrowUp" && results.length > 0) {
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
  <div class="bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
      <span class="text-zinc-500 text-sm">Search docs</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={query}
        placeholder="Type to search..."
        class="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder-zinc-600"
        autofocus
      />
      <kbd class="text-2xs text-zinc-600 border border-zinc-800 px-1.5 py-0.5">ESC</kbd>
    </div>

    {#if results.length > 0}
      <ul class="max-h-72 overflow-y-auto py-1">
        {#each results as result, i}
          <li>
            <button
              class="list-item px-4 flex items-center gap-2"
              data-active={i === selectedIdx || undefined}
              onclick={() => pick(result.id)}
            >
              <span class="font-medium">{result.title}</span>
              <span class="text-zinc-600 text-2xs">{result.id}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if !searchIdx}
      <div class="px-4 py-3 text-center text-xs text-zinc-600">Loading search index...</div>
    {:else if query.length >= 2}
      <div class="px-4 py-3 text-center text-xs text-zinc-600">No results for &ldquo;{query}&rdquo;</div>
    {:else}
      <div class="px-4 py-3 text-center text-xs text-zinc-600">Start typing to search documentation</div>
    {/if}
  </div>
</dialog>
