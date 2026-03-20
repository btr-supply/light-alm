<script lang="ts">
  import type { NavNode } from "$lib/docs";

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
        <span class="text-2xs uppercase tracking-wider text-zinc-500 px-2 block mb-1">{node.label}</span>
        {#each node.children as child}
          <button
            class="list-item"
            data-active={currentPageId === child.id || undefined}
            onclick={() => child.id && onSelect(child.id)}
          >{child.label}</button>
        {/each}
      </div>
    {:else}
      <button
        class="list-item"
        data-active={currentPageId === node.id || undefined}
        onclick={() => node.id && onSelect(node.id)}
      >{node.label}</button>
    {/if}
  {/each}
</nav>
