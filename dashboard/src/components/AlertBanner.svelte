<script lang="ts">
  import { ALERT } from "../lib/theme";

  interface Props { message: string; title?: string; }
  let { message, title }: Props = $props();
</script>

<div class={ALERT.box}>
  {#if title}<span class={ALERT.title}>{title}</span>{/if}
  <span class="{ALERT.msg} {title ? 'ml-1' : ''}">{message}</span>
</div>
