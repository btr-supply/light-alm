import MiniSearch from "minisearch";

const modules = import.meta.glob("../../../docs/**/*.md", { query: "?raw", eager: true });

export interface DocPage {
  id: string;
  title: string;
  content: string;
  headings: { level: number; text: string; slug: string }[];
}

export interface NavNode {
  label: string;
  id?: string;
  children?: NavNode[];
}

// Order groups appear in sidebar
const GROUP_ORDER = [
  "index",
  "overview",
  "architecture",
  "glossary",
  "strategy",
  "execution",
  "data",
  "infrastructure",
  "config",
  "dashboard",
];

interface MdModule {
  default: { html: string; headings: DocPage["headings"] };
}

export function loadDocs(): DocPage[] {
  return Object.entries(modules)
    .map(([path, mod]) => {
      const { html, headings } = (mod as MdModule).default;
      const id = path.replace(/^.*\/docs\//, "").replace(/\.md$/, "");
      const title = headings.find((h) => h.level === 1)?.text ?? id;
      return { id, title, content: html, headings };
    })
    .sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.id.split("/")[0]);
      const gb = GROUP_ORDER.indexOf(b.id.split("/")[0]);
      return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
    });
}

export function buildSearchIndex(pages: DocPage[]): MiniSearch<DocPage> {
  const index = new MiniSearch<DocPage>({
    fields: ["title", "content"],
    storeFields: ["id", "title"],
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2 },
    extractField: (doc, fieldName) => {
      const val = (doc as any)[fieldName] as string;
      if (fieldName === "content") return val.replace(/<[^>]+>/g, " ");
      return val;
    },
  });
  index.addAll(pages.map((p, i) => ({ ...p, id: i })));
  // Store mapping from numeric ID back to page ID
  (index as any)._pageIds = pages.map((p) => p.id);
  return index;
}

export function searchDocs(
  index: MiniSearch<DocPage>,
  query: string,
  limit = 10,
): { id: string; title: string }[] {
  if (query.length < 2) return [];
  const pageIds: string[] = (index as any)._pageIds;
  return index.search(query, { limit }).map((r) => ({
    id: pageIds[r.id as number],
    title: r.title as string,
  }));
}

export function buildNavTree(pages: DocPage[]): NavNode[] {
  const groups: Record<string, DocPage[]> = {};
  const topLevel: DocPage[] = [];

  for (const page of pages) {
    const parts = page.id.split("/");
    if (parts.length === 1) topLevel.push(page);
    else (groups[parts[0]] ??= []).push(page);
  }

  const tree: NavNode[] = topLevel.map((p) => ({ label: p.title, id: p.id }));

  for (const group of GROUP_ORDER) {
    const children = groups[group];
    if (!children) continue;
    tree.push({
      label: group.charAt(0).toUpperCase() + group.slice(1),
      children: children.map((p) => ({ label: p.title, id: p.id })),
    });
  }

  return tree;
}
