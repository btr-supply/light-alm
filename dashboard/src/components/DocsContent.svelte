<script lang="ts">
  import type { DocPage } from "$lib/docs";
  import { TEXT, CARD } from "$lib/theme";

  interface Props {
    page: DocPage;
    onNavigate: (id: string, anchor?: string) => void;
  }

  let { page, onNavigate }: Props = $props();

  let tocEntries = $derived(page.headings.filter((h) => h.level === 2));

  function handleClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest("[data-doc]") as HTMLElement | null;
    if (target) {
      e.preventDefault();
      onNavigate(target.dataset.doc!, target.dataset.anchor);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onclick={handleClick}>
  {#if tocEntries.length > 2}
    <nav class="{CARD} p-3 mb-4">
      <span class="text-xs {TEXT.label} uppercase tracking-wider">Contents</span>
      <ul class="mt-1 space-y-0.5">
        {#each tocEntries as entry}
          <li><a href="#{entry.slug}" class="text-xs {TEXT.secondary} hover:text-zinc-100">{entry.text}</a></li>
        {/each}
      </ul>
    </nav>
  {/if}

  <article class="prose-custom">
    {@html page.content}
  </article>
</div>

<style>
  .prose-custom :global(h1) { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; color: #f4f4f5; }
  .prose-custom :global(h2) { font-size: 1.125rem; font-weight: 600; margin-top: 2rem; margin-bottom: 0.5rem; color: #e4e4e7; border-bottom: 1px solid #27272a; padding-bottom: 0.25rem; }
  .prose-custom :global(h3) { font-size: 0.95rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #d4d4d8; }
  .prose-custom :global(h4) { font-size: 0.85rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.25rem; color: #a1a1aa; }
  .prose-custom :global(p) { font-size: 0.8125rem; line-height: 1.6; margin-bottom: 0.75rem; color: #d4d4d8; }
  .prose-custom :global(ul), .prose-custom :global(ol) { font-size: 0.8125rem; line-height: 1.6; margin-bottom: 0.75rem; padding-left: 1.5rem; color: #d4d4d8; }
  .prose-custom :global(ul) { list-style-type: disc; }
  .prose-custom :global(ol) { list-style-type: decimal; }
  .prose-custom :global(li) { margin-bottom: 0.25rem; }
  .prose-custom :global(a:not(.doc-link)) { color: #60a5fa; text-decoration: underline; text-underline-offset: 2px; }
  .prose-custom :global(.doc-link) { color: #818cf8; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .prose-custom :global(code) { font-size: 0.75rem; background: #27272a; padding: 0.125rem 0.375rem; border-radius: 0.25rem; color: #f4f4f5; }
  .prose-custom :global(pre) { background: #18181b; border: 1px solid #27272a; border-radius: 0.375rem; padding: 0.75rem 1rem; overflow-x: auto; margin-bottom: 1rem; }
  .prose-custom :global(pre code) { background: none; padding: 0; font-size: 0.75rem; line-height: 1.5; }
  .prose-custom :global(table) { width: 100%; font-size: 0.75rem; border-collapse: collapse; margin-bottom: 1rem; }
  .prose-custom :global(th) { text-align: left; padding: 0.375rem 0.5rem; border-bottom: 1px solid #3f3f46; color: #a1a1aa; font-weight: 600; }
  .prose-custom :global(td) { padding: 0.375rem 0.5rem; border-bottom: 1px solid #27272a; color: #d4d4d8; }
  .prose-custom :global(blockquote) { border-left: 3px solid #3f3f46; padding-left: 1rem; margin: 0.75rem 0; color: #a1a1aa; font-style: italic; }
  .prose-custom :global(strong) { color: #e4e4e7; }
  .prose-custom :global(hr) { border-color: #27272a; margin: 1.5rem 0; }
  .prose-custom :global(math) { font-family: "Latin Modern Math", "STIX Two Math", "Cambria Math", serif; color: #e4e4e7; }
  .prose-custom :global(math[display="block"]) { display: block; text-align: center; margin: 1rem 0; font-size: 1rem; overflow-x: auto; }
</style>
