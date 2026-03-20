<script lang="ts">
  interface Props {
    title: string;
    expanded?: boolean;
    children?: import("svelte").Snippet;
  }

  let { title, expanded = $bindable(true), children }: Props = $props();
</script>

<button class="w-full flex items-center justify-between px-2 py-1 border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors" onclick={() => expanded = !expanded}>
  <span class="section-header">{title}</span>
  <span class="text-zinc-600 text-2xs">{expanded ? "\u25B2" : "\u25BC"}</span>
</button>
{#if expanded}
  <div class="px-2 py-1.5 space-y-1 border-b border-zinc-800/40">
    {@render children?.()}
  </div>
{/if}
