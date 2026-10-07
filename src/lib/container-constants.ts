// Shared container category / height-class constants & helpers.
// Dry containers must always carry a height_class (HC = High Cube, LC = Low Cube).
// All other categories must NOT carry one.

export const CONTAINER_CATEGORIES = ["dry", "reefer", "tank", "flat_rack", "open_top"] as const;
export type ContainerCategory = (typeof CONTAINER_CATEGORIES)[number];

export const HEIGHT_CLASSES = ["HC", "LC"] as const;
export type HeightClass = (typeof HEIGHT_CLASSES)[number];

export const CATEGORY_LABELS: Record<ContainerCategory, string> = {
  dry: "Dry",
  reefer: "Reefer",
  tank: "Tank",
  flat_rack: "Flat Rack",
  open_top: "Open Top",
};

export const HEIGHT_CLASS_LABELS: Record<HeightClass, string> = {
  HC: "High Cube (HC)",
  LC: "Low Cube (LC)",
};

export function requiresHeightClass(category?: string | null): boolean {
  return category === "dry";
}

/** Single source of truth for displaying a container's category in any UI. */
export function formatCategory(category?: string | null, height_class?: string | null): string {
  if (!category) return "—";
  const base = CATEGORY_LABELS[category as ContainerCategory] ?? category.replace("_", " ");
  if (category === "dry" && height_class) return `${base} · ${height_class}`;
  return base;
}
