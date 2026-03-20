<script lang="ts">
  interface Props {
    tabs: string[];
    active: string;
    onchange: (tab: string) => void;
  }

  let { tabs, active, onchange }: Props = $props();
</script>

<div class="flex border-b border-zinc-800">
  {#each tabs as tab}
    <button
      class="tab"
      data-active={active === tab || undefined}
      onclick={() => onchange(tab)}>{tab}</button>
  {/each}
</div>
