<script lang="ts">
  import { onMount } from "svelte";
  import { loadDocs, buildNavTree, type DocPage } from "$lib/docs";
  import DocsSidebar from "./DocsSidebar.svelte";
  import DocsContent from "./DocsContent.svelte";

  let pages = $state<DocPage[]>([]);
  let navTree = $derived(buildNavTree(pages));
  let pageMap = $derived(new Map(pages.map((p) => [p.id, p])));

  let currentPageId = $state("");
  let currentPage = $derived(pageMap.get(currentPageId) ?? null);

  onMount(() => {
    loadDocs().then((p) => {
      pages = p;
      currentPageId = p.find((pg) => pg.id === "index")?.id ?? p[0]?.id ?? "";
    });
  });

  export function navigate(id: string, anchor?: string) {
    if (pageMap.has(id)) {
      currentPageId = id;
      if (anchor) {
        requestAnimationFrame(() => {
          document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
        });
      }
    }
  }
</script>

<div class="flex h-full overflow-hidden">
  <aside class="w-52 shrink-0 border-r border-zinc-800 overflow-y-auto">
    <DocsSidebar tree={navTree} {currentPageId} onSelect={(id) => currentPageId = id} />
  </aside>

  <main class="flex-1 overflow-y-auto p-4">
    {#if currentPage}
      <DocsContent page={currentPage} onNavigate={navigate} />
    {:else if pages.length === 0}
      <p class="text-sm text-zinc-600">Loading documentation...</p>
    {:else}
      <p class="text-sm text-zinc-600">No documentation loaded.</p>
    {/if}
  </main>
</div>
