import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type JobOption = {
  id: string;
  conversion_number: string;
  project_id: string | null;
  status: string | null;
  customers?: { name?: string | null } | null;
};

/** Active conversion jobs, with customer name, for tagging finance documents. */
export function useConversionJobs() {
  return useQuery<JobOption[]>({
    queryKey: ["conversions-for-expense"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("container_conversions")
        .select("id,conversion_number,project_id,status,customers(name)")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as JobOption[];
    },
  });
}

/**
 * Searchable job picker. Jobs belonging to the selected project are listed
 * first; if that project has no jobs, every job stays selectable so the field
 * never looks empty.
 */
export function JobCombobox({
  value,
  onChange,
  projectId,
  placeholder = "Optional — search job number or customer",
  disabled,
}: {
  value: string;
  onChange: (jobId: string, job: JobOption | null) => void;
  projectId?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: jobs = [] } = useConversionJobs();

  const ordered = useMemo(() => {
    if (!projectId) return jobs;
    const mine = jobs.filter((j) => j.project_id === projectId);
    const rest = jobs.filter((j) => j.project_id !== projectId);
    return [...mine, ...rest];
  }, [jobs, projectId]);

  const selected = jobs.find((j) => j.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${selected.conversion_number}${selected.customers?.name ? ` — ${selected.customers.name}` : ""}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search job number or customer…" />
          <CommandList>
            <CommandEmpty>No job found.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__none__"
                  onSelect={() => { onChange("", null); setOpen(false); }}
                >
                  <span className="text-muted-foreground">Clear job</span>
                </CommandItem>
              )}
              {ordered.map((j) => (
                <CommandItem
                  key={j.id}
                  value={`${j.conversion_number} ${j.customers?.name ?? ""}`}
                  onSelect={() => { onChange(j.id, j); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === j.id ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs">{j.conversion_number}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">{j.customers?.name ?? "No customer"}</span>
                  {j.status && <Badge variant="outline" className="ml-auto text-[10px]">{j.status.replace("_", " ")}</Badge>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
