<script lang="ts">
  import type { NavNode } from "$lib/docs";
  import { SMALL, TEXT } from "$lib/theme";

  interface Props {
    tree: NavNode[];
    currentPageId: string;
    onSelect: (id: string) => void;
  }

  let { tree, currentPageId, onSelect }: Props = $props();
</script>

<nav class="p-2 space-y-1">
  {#each tree as node}
    {#if node.children}
      <div class="mt-3 first:mt-0">
        <span class="{SMALL} uppercase tracking-wider {TEXT.label} px-2 block mb-1">{node.label}</span>
        {#each node.children as child}
          <button
            class="w-full text-left px-3 py-1.5 rounded text-xs transition-colors
              {currentPageId === child.id ? 'bg-zinc-800 text-zinc-100' : TEXT.secondary + ' hover:bg-zinc-800/50'}"
            onclick={() => child.id && onSelect(child.id)}
          >{child.label}</button>
        {/each}
      </div>
    {:else}
      <button
        class="w-full text-left px-3 py-1.5 rounded text-xs transition-colors
          {currentPageId === node.id ? 'bg-zinc-800 text-zinc-100' : TEXT.secondary + ' hover:bg-zinc-800/50'}"
        onclick={() => node.id && onSelect(node.id)}
      >{node.label}</button>
    {/if}
  {/each}
</nav>
