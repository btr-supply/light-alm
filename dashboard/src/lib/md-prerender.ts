import temml from "temml";
import { marked } from "marked";
import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface Heading {
  level: number;
  text: string;
  slug: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Replace $$...$$ and $...$ with temml MathML.
 * Masks fenced code blocks and inline code spans first to avoid false matches.
 */
function processMath(md: string): string {
  const masked: string[] = [];
  const mask = (s: string) => {
    const i = masked.length;
    masked.push(s);
    return `\x00M${i}\x00`;
  };

  // Mask fenced code blocks, then inline code spans
  let result = md.replace(/```[\s\S]*?```/g, (m) => mask(m));
  result = result.replace(/`[^`\n]+`/g, (m) => mask(m));

  // Display math: $$...$$
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try {
      return temml.renderToString(tex.trim(), { displayMode: true });
    } catch {
      return `<code>${tex.trim()}</code>`;
    }
  });

  // Inline math: $...$  — word-boundary guards prevent matching prose dollar amounts
  result = result.replace(/(?<!\w)\$([^\$\n]+?)\$(?!\w)/g, (_, tex) => {
    try {
      return temml.renderToString(tex.trim(), { displayMode: false });
    } catch {
      return `<code>${tex.trim()}</code>`;
    }
  });

  // Restore masked content
  return result.replace(/\x00M(\d+)\x00/g, (_, i) => masked[Number(i)]);
}

/** Extract heading levels, text, and slug from raw markdown. */
function extractHeadings(md: string): Heading[] {
  const result: Heading[] = [];
  for (const m of md.matchAll(/^(#{1,4})\s+(.+)$/gm)) {
    const text = m[2]
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .trim();
    result.push({ level: m[1].length, text, slug: slugify(text) });
  }
  return result;
}

/**
 * Rewrite relative .md links to data-doc navigation links.
 * Resolves paths relative to the source file's directory within docs/.
 */
function rewriteDocLinks(md: string, sourceDir: string): string {
  return md.replace(
    /\[([^\]]+)\]\(((?:\.\.?\/)*[a-z][a-z0-9/_\-]*?)\.md(?:#([a-z0-9\-]+))?\)/g,
    (_match, text, relPath, anchor) => {
      // Resolve the relative path against the source file's directory
      const resolved = resolve(`/${sourceDir}`, relPath).slice(1); // resolve against virtual root
      const id = resolved.replace(/^docs\//, "");
      const anchorAttr = anchor ? ` data-anchor="${anchor}"` : "";
      return `<a href="#" data-doc="${id}"${anchorAttr} class="doc-link">${text}</a>`;
    },
  );
}

/** Add id attributes to rendered headings for ToC anchor links. */
function addHeadingIds(html: string): string {
  return html.replace(/<h([1-4])>(.*?)<\/h\1>/g, (_, level, content) => {
    const text = content.replace(/<[^>]+>/g, "").trim();
    return `<h${level} id="${slugify(text)}">${content}</h${level}>`;
  });
}

/**
 * Vite plugin: full build-time markdown pipeline.
 * .md?raw imports → { html, headings } with math, links, and markdown pre-rendered.
 */
export function mdPrerender(): Plugin {
  return {
    name: "md-prerender",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(".md?raw")) return;
      const filePath = id.replace(/\?raw$/, "");
      const raw = await readFile(filePath, "utf-8");

      // Directory relative to docs/ root (e.g. "strategy", "config", "." for top-level)
      const docsIdx = filePath.lastIndexOf("/docs/");
      const sourceDir = dirname(filePath.slice(docsIdx + 6));

      const headings = extractHeadings(raw);
      const withMath = processMath(raw);
      const withLinks = rewriteDocLinks(withMath, sourceDir);
      let html = marked.parse(withLinks, { async: false }) as string;
      html = addHeadingIds(html);
      return `export default ${JSON.stringify({ html, headings })}`;
    },
  };
}
