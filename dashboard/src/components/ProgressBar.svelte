<script lang="ts">
  import { SMALL } from "../lib/theme";

  interface Props {
    value: number;
    color?: string;
    height?: string;
    label?: string;
  }

  let { value, color = "bg-blue-600/80", height = "h-3", label }: Props = $props();
</script>

<div class="flex-1 bg-zinc-800 rounded-full {height} overflow-hidden">
  <div
    class="{height} rounded-full transition-all duration-500 {color} {label ? 'flex items-center px-2' : ''}"
    style="width: {Math.max(value, 5)}%"
  >
    {#if label}
      <span class="{SMALL} text-white">{label}</span>
    {/if}
  </div>
</div>
