<script lang="ts">
  import { TEXT } from "../lib/theme";
  let { label, value, cls = TEXT.primary }: { label: string; value: string; cls?: string } = $props();
</script>
<div><span class={TEXT.label}>{label}</span><span class="ml-1 {cls}">{value}</span></div>
