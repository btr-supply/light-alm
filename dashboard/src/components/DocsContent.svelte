<script lang="ts">
  import type { DocPage } from "$lib/docs";

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
    <nav class="card p-3 mb-4">
      <span class="text-xs text-zinc-500 uppercase tracking-wider">Contents</span>
      <ul class="mt-1 space-y-0.5">
        {#each tocEntries as entry}
          <li><a href="#{entry.slug}" class="text-xs text-zinc-400 hover:text-zinc-100">{entry.text}</a></li>
        {/each}
      </ul>
    </nav>
  {/if}

  <article class="prose-custom">
    {@html page.content}
  </article>
</div>
