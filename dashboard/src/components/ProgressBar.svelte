<script lang="ts">
  interface Props {
    value: number;
    level?: string;
    height?: string;
    label?: string;
  }

  let { value, level, height = "h-3", label }: Props = $props();
</script>

<div class="progress-bar {height}">
  <div
    class="progress-fill {height} {label ? 'flex items-center px-2' : ''}"
    data-level={level}
    style="width: {value > 0 ? Math.max(value, 2) : 0}%"
  >
    {#if label}
      <span class="text-2xs text-white">{label}</span>
    {/if}
  </div>
</div>
