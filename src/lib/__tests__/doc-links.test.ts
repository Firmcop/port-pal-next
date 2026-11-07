import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DOC_LINKS } from "@/lib/doc-links";

/** Every route under src/app, with route groups like (app) removed. */
function appRoutes(dir = join(process.cwd(), "src/app"), prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const seg = /^\(.*\)$/.test(name) ? "" : `/${name}`;
      out.push(...appRoutes(full, prefix + seg));
    } else if (name === "page.tsx") {
      out.push(prefix || "/");
    }
  }
  return out;
}

const routes = appRoutes();
const exists = (path: string) =>
  routes.some((r) => new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(path));

describe("approval and notification links", () => {
  for (const [docType, link] of Object.entries(DOC_LINKS)) {
    it(`${docType} opens a page that exists`, () => {
      for (const id of [undefined, "00000000-0000-0000-0000-000000000001"]) {
        const path = link(id).split("?")[0];
        expect(exists(path), `${docType} -> ${path}`).toBe(true);
      }
    });
  }
});
