<script lang="ts">
  interface Props {
    tabs: string[];
    active: string;
    onchange: (tab: string) => void;
    position?: "left" | "right";
  }

  let { tabs, active, onchange, position = "left" }: Props = $props();
</script>

<div class="absolute top-1 {position === 'right' ? 'right-2' : 'left-2'} z-10 flex gap-0.5 chart-overlay px-1 py-0.5">
  {#each tabs as tab}
    <button
      class="toggle"
      data-active={active === tab || undefined}
      onclick={() => onchange(tab)}>{tab}</button>
  {/each}
</div>
