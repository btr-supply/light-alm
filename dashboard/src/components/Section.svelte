<script lang="ts">
  import { SECTION_HEADER, EMPTY_STATE } from "../lib/theme";

  interface Props {
    title: string;
    empty?: boolean;
    emptyText?: string;
    children?: import("svelte").Snippet;
  }

  let { title, empty = false, emptyText = "No data", children }: Props = $props();
</script>

<div>
  <h3 class={SECTION_HEADER}>{title}</h3>
  {#if empty}
    <span class={EMPTY_STATE}>{emptyText}</span>
  {:else}
    {@render children?.()}
  {/if}
</div>
