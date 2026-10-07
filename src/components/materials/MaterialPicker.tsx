import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronsUpDown, PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";

export type CatalogMaterial = {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  unit_cost: number | null;
  avg_unit_cost: number | null;
  on_hand_qty: number | null;
};

/** Active catalogue materials with their live on-hand quantity. */
export function useMaterialCatalogWithStock() {
  return useQuery({
    queryKey: ["materials-catalog-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materials")
        .select("id, name, category, unit, unit_cost, avg_unit_cost, on_hand_qty")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CatalogMaterial[];
    },
  });
}

export function materialCategories(list: CatalogMaterial[]): string[] {
  return Array.from(new Set(list.map((m) => m.category || "Other"))).sort();
}

/**
 * Searchable material picker with a category filter and an
 * "in stock only" mode used wherever material is actually consumed.
 */
export function MaterialPicker({
  value,
  onChange,
  materials,
  inStockOnly = false,
  allowCustom = false,
  placeholder = "Search material…",
  disabled,
}: {
  value: string | null;
  onChange: (id: string | null, material: CatalogMaterial | null) => void;
  materials: CatalogMaterial[];
  inStockOnly?: boolean;
  allowCustom?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("__all");

  const categories = useMemo(() => materialCategories(materials), [materials]);

  const filtered = useMemo(() => {
    return materials.filter((m) => {
      if (category !== "__all" && (m.category || "Other") !== category) return false;
      if (inStockOnly && Number(m.on_hand_qty ?? 0) <= 0) return false;
      return true;
    });
  }, [materials, category, inStockOnly]);

  const selected = materials.find((m) => m.id === value) ?? null;

  return (
    <div className="flex gap-2">
      <Select value={category} onValueChange={setCategory}>
        <SelectTrigger className="w-[9.5rem] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All categories</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="flex-1 justify-between font-normal"
          >
            <span className="truncate">
              {selected ? selected.name : allowCustom && value === null ? "Custom item" : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Type to search…" />
            <CommandList>
              <CommandEmpty>
                <span className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                  <PackageSearch className="h-4 w-4" />
                  {inStockOnly ? "No matching material in stock" : "No material found"}
                </span>
              </CommandEmpty>
              {allowCustom && (
                <CommandGroup>
                  <CommandItem
                    value="custom item"
                    onSelect={() => { onChange(null, null); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                    Custom item (no stock movement)
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup heading={`${filtered.length} material(s)`}>
                {filtered.map((m) => {
                  const stock = Number(m.on_hand_qty ?? 0);
                  return (
                    <CommandItem
                      key={m.id}
                      value={`${m.name} ${m.category ?? ""}`}
                      onSelect={() => { onChange(m.id, m); setOpen(false); }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === m.id ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1 truncate">{m.name}</span>
                      <Badge variant="outline" className="ml-2 text-[10px]">{m.category || "Other"}</Badge>
                      <span className={cn("ml-2 font-mono text-xs", stock > 0 ? "text-muted-foreground" : "text-destructive")}>
                        {stock} {m.unit ?? ""}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
