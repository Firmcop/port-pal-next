import { supabase } from "@/integrations/supabase/client";
import type { ParsedRow } from "@/lib/excel-io";

export type YardBlockMeta = {
  id: string;
  name: string;
  max_bays: number;
  max_rows: number;
  max_tiers: number;
  has_power: boolean;
  hazardous_zone: boolean;
};

export type PreflightIssue = { rowNumber: number; message: string };

export async function loadYardContext(orgId: string) {
  const { data: blocks } = await supabase
    .from("yard_blocks")
    .select("id,name,max_bays,max_rows,max_tiers,has_power,hazardous_zone")
    .eq("organization_id", orgId);
  const byName = new Map<string, YardBlockMeta>();
  for (const b of (blocks ?? []) as YardBlockMeta[]) {
    byName.set(b.name.toLowerCase(), b);
  }

  const { data: occupied } = await supabase
    .from("containers")
    .select("container_number,block_id,bay,row,tier,hazard_class")
    .eq("organization_id", orgId)
    .not("block_id", "is", null);
  const occMap = new Map<string, { container_number: string; hazard_class: string | null }>();
  const hazardByBay = new Map<string, Set<string>>();
  for (const c of occupied ?? []) {
    if (!c.block_id || !c.bay || !c.row || !c.tier) continue;
    const k = `${c.block_id}|${c.bay}|${c.row}|${c.tier}`;
    occMap.set(k, { container_number: c.container_number, hazard_class: c.hazard_class });
    if (c.hazard_class) {
      const bk = `${c.block_id}|${c.bay}`;
      if (!hazardByBay.has(bk)) hazardByBay.set(bk, new Set());
      hazardByBay.get(bk)!.add(c.hazard_class);
    }
  }
  return { byName, occMap, hazardByBay };
}

export function preflightContainerRows(
  rows: ParsedRow[],
  ctx: Awaited<ReturnType<typeof loadYardContext>>,
): Map<number, string[]> {
  const issues = new Map<number, string[]>();
  const add = (n: number, m: string) => {
    if (!issues.has(n)) issues.set(n, []);
    issues.get(n)!.push(m);
  };

  // Track upload-internal duplicates and hazard-by-bay assignments
  const uploadSlots = new Map<string, number[]>(); // slotKey -> rowNumbers
  const uploadHazardByBay = new Map<string, Map<string, number[]>>(); // bayKey -> class -> rows

  for (const r of rows) {
    const d = r.data;
    if (!d.block_name) continue;
    const block = ctx.byName.get(String(d.block_name).toLowerCase());
    if (!block) {
      add(r.rowNumber, `Yard block "${d.block_name}" not found`);
      continue;
    }
    const bay = Number(d.bay), row = Number(d.row), tier = Number(d.tier);
    if (!bay || !row || !tier) {
      add(r.rowNumber, "Bay/Row/Tier required when block is set");
      continue;
    }
    if (bay > block.max_bays || row > block.max_rows || tier > block.max_tiers) {
      add(r.rowNumber, `Slot out of range (block is ${block.max_bays}×${block.max_rows}×${block.max_tiers})`);
    }
    if (d.category === "reefer" && !block.has_power) {
      add(r.rowNumber, `Block "${block.name}" has no power point — cannot place reefer`);
    }
    if (d.hazard_class && !block.hazardous_zone) {
      add(r.rowNumber, `Block "${block.name}" is not a hazardous zone — cannot place hazard class ${d.hazard_class}`);
    }

    const slotKey = `${block.id}|${bay}|${row}|${tier}`;
    if (!uploadSlots.has(slotKey)) uploadSlots.set(slotKey, []);
    uploadSlots.get(slotKey)!.push(r.rowNumber);

    const existingOcc = ctx.occMap.get(slotKey);
    if (existingOcc && existingOcc.container_number !== d.container_number) {
      add(r.rowNumber, `Slot occupied by ${existingOcc.container_number}`);
    }

    if (d.hazard_class) {
      const bayKey = `${block.id}|${bay}`;
      if (!uploadHazardByBay.has(bayKey)) uploadHazardByBay.set(bayKey, new Map());
      const m = uploadHazardByBay.get(bayKey)!;
      if (!m.has(d.hazard_class)) m.set(d.hazard_class, []);
      m.get(d.hazard_class)!.push(r.rowNumber);

      // DB segregation check: existing hazard classes in this bay
      const dbClasses = ctx.hazardByBay.get(bayKey);
      if (dbClasses) {
        for (const c of dbClasses) {
          if (c !== d.hazard_class) {
            add(r.rowNumber, `Bay already holds hazard class ${c}; cannot mix with ${d.hazard_class}`);
            break;
          }
        }
      }
    }
  }

  // Duplicate slots within the upload
  for (const [_, rowNums] of uploadSlots) {
    if (rowNums.length > 1) {
      for (const rn of rowNums) add(rn, `Duplicate slot also used by rows ${rowNums.filter((x) => x !== rn).join(", ")}`);
    }
  }
  // Hazard segregation within upload
  for (const [, classMap] of uploadHazardByBay) {
    if (classMap.size > 1) {
      const summary = Array.from(classMap.keys()).join("/");
      for (const rows of classMap.values()) {
        for (const rn of rows) add(rn, `Bay mixes hazard classes (${summary}) within upload`);
      }
    }
  }

  return issues;
}
