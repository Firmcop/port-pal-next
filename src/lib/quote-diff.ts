// Compare two quote snapshots and return a structured diff for display.

export type Snapshot = {
  header: any;
  sections: any[];
  items: any[];
};

export type SectionDiff = {
  section_id: string;
  title: string;
  status: "unchanged" | "added" | "removed" | "changed";
  prevSubtotal: number;
  nextSubtotal: number;
  itemDiffs: ItemDiff[];
};

export type ItemDiff = {
  key: string;
  description: string;
  status: "unchanged" | "added" | "removed" | "changed";
  prev?: any;
  next?: any;
  changedFields?: string[];
};

const num = (v: any) => Number(v ?? 0);

function itemKey(it: any) {
  if (it.ref_id) return `${it.section_id}::ref:${it.ref_id}`;
  return `${it.section_id}::desc:${(it.description ?? "").trim().toLowerCase()}::${it.unit ?? ""}`;
}

function subtotal(items: any[]) {
  return items.reduce((s, it) => s + num(it.total_price), 0);
}

export function diffSnapshots(prev: Snapshot | null, next: Snapshot): { sections: SectionDiff[]; totals: { prev: number; next: number } } {
  const prevSections = prev?.sections ?? [];
  const nextSections = next.sections ?? [];
  const prevItems = prev?.items ?? [];
  const nextItems = next.items ?? [];

  const allSectionIds = Array.from(new Set([
    ...prevSections.map((s) => s.id),
    ...nextSections.map((s) => s.id),
  ]));

  const sectionDiffs: SectionDiff[] = allSectionIds.map((sid) => {
    const ps = prevSections.find((s) => s.id === sid);
    const ns = nextSections.find((s) => s.id === sid);
    const pItems = prevItems.filter((i) => i.section_id === sid);
    const nItems = nextItems.filter((i) => i.section_id === sid);

    let status: SectionDiff["status"] = "unchanged";
    if (!ps) status = "added";
    else if (!ns) status = "removed";

    const keys = new Set<string>();
    pItems.forEach((i) => keys.add(itemKey(i)));
    nItems.forEach((i) => keys.add(itemKey(i)));

    const itemDiffs: ItemDiff[] = Array.from(keys).map((k) => {
      const p = pItems.find((i) => itemKey(i) === k);
      const n = nItems.find((i) => itemKey(i) === k);
      if (!p && n) return { key: k, status: "added", next: n, description: n.description };
      if (p && !n) return { key: k, status: "removed", prev: p, description: p.description };
      const changed: string[] = [];
      const fields = ["quantity", "unit_price", "discount_pct", "tax_pct", "description", "unit"];
      fields.forEach((f) => {
        const a = (p as any)[f];
        const b = (n as any)[f];
        if (typeof a === "number" || typeof b === "number") {
          if (num(a) !== num(b)) changed.push(f);
        } else if ((a ?? "") !== (b ?? "")) changed.push(f);
      });
      return {
        key: k,
        status: changed.length ? "changed" : "unchanged",
        prev: p, next: n,
        changedFields: changed,
        description: n!.description,
      };
    });

    if (status === "unchanged" && itemDiffs.some((d) => d.status !== "unchanged")) status = "changed";

    return {
      section_id: sid,
      title: ns?.title ?? ps?.title ?? "(untitled)",
      status,
      prevSubtotal: subtotal(pItems),
      nextSubtotal: subtotal(nItems),
      itemDiffs,
    };
  });

  return {
    sections: sectionDiffs,
    totals: {
      prev: subtotal(prevItems),
      next: subtotal(nextItems),
    },
  };
}
