<script lang="ts">
  interface Props { message: string; title?: string; }
  let { message, title }: Props = $props();
</script>

<div class="alert">
  {#if title}<span class="alert-title">{title}</span>{/if}
  <span class="alert-msg {title ? 'ml-1' : ''}">{message}</span>
</div>
