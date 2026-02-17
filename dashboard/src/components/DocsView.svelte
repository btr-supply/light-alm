<script lang="ts">
  import { loadDocs, buildNavTree, type DocPage } from "$lib/docs";
  import DocsSidebar from "./DocsSidebar.svelte";
  import DocsContent from "./DocsContent.svelte";
  import { LAYOUT, TEXT } from "$lib/theme";

  const pages = loadDocs();
  const navTree = buildNavTree(pages);
  const pageMap = new Map(pages.map((p) => [p.id, p]));

  let currentPageId = $state(pages.find((p) => p.id === "index")?.id ?? pages[0]?.id ?? "");
  let currentPage = $derived(pageMap.get(currentPageId) ?? null);

  export function navigate(id: string, anchor?: string) {
    if (pageMap.has(id)) {
      currentPageId = id;
      if (anchor) {
        // Tick to let Svelte render the new page, then scroll to anchor
        requestAnimationFrame(() => {
          document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
        });
      }
    }
  }
</script>

<div class="flex h-full overflow-hidden">
  <aside class="{LAYOUT.sidebarW} shrink-0 border-r border-zinc-800 overflow-y-auto">
    <DocsSidebar tree={navTree} {currentPageId} onSelect={(id) => currentPageId = id} />
  </aside>

  <main class="flex-1 overflow-y-auto p-6">
    {#if currentPage}
      <DocsContent page={currentPage} onNavigate={navigate} />
    {:else}
      <p class="text-sm {TEXT.dim}">No documentation loaded.</p>
    {/if}
  </main>
</div>
