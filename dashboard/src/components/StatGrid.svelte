<script lang="ts">
  import { TEXT } from "../lib/theme";
  import Section from "./Section.svelte";

  interface Props {
    title: string;
    items: [string, string][];
  }

  let { title, items }: Props = $props();
</script>

<Section {title}>
  <div class="grid grid-cols-2 gap-1 text-xs">
    {#each items as [label, value]}
      <span class={TEXT.label}>{label}</span>
      <span class="{TEXT.value} text-right">{value}</span>
    {/each}
  </div>
</Section>
