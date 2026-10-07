import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export interface SupplierOption {
  id: string;
  name: string;
}

/**
 * Searchable picker over the supplier register with an inline "create supplier"
 * popup, so a transporter or crane vendor that is not registered yet can be
 * added without leaving the container form. The value is the supplier name so
 * it stays compatible with the free-text vendor fields already stored on
 * containers and invoices.
 */
export default function SupplierCombobox({
  value,
  onChange,
  placeholder = "Select supplier",
  extraOptions = [],
  disabled,
  invalid,
}: {
  value: string;
  onChange: (name: string, supplierId?: string | null) => void;
  placeholder?: string;
  /** Ad-hoc names to offer alongside registered suppliers (e.g. the transporter typed above). */
  extraOptions?: string[];
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", tax_number: "" });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-combobox"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,is_active")
        .order("name");
      if (error) throw error;
      return (data ?? []).filter((s: any) => s.is_active !== false) as SupplierOption[];
    },
  });

  const options = useMemo(() => {
    const seen = new Set(suppliers.map((s) => s.name.trim().toLowerCase()));
    const extras = extraOptions
      .map((n) => (n ?? "").trim())
      .filter((n) => n.length > 1 && !seen.has(n.toLowerCase()))
      .map((n) => ({ id: `extra:${n}`, name: n }));
    const unregistered =
      value && !seen.has(value.trim().toLowerCase()) && !extras.some((e) => e.name === value)
        ? [{ id: "current", name: value }]
        : [];
    return [...extras, ...unregistered, ...suppliers];
  }, [suppliers, extraOptions, value]);

  const create = useMutation({
    mutationFn: async () => {
      const name = draft.name.trim();
      if (name.length < 2) throw new Error("Enter the supplier name");
      const { data, error } = await supabase
        .from("suppliers")
        .insert({
          name,
          phone: draft.phone.trim() || null,
          email: draft.email.trim() || null,
          tax_number: draft.tax_number.trim() || null,
          is_active: true,
        } as any)
        .select("id,name")
        .single();
      if (error) throw error;
      return data as SupplierOption;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["suppliers-combobox"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      onChange(s.name, s.id);
      setCreateOpen(false);
      setOpen(false);
      setDraft({ name: "", phone: "", email: "", tax_number: "" });
      toast({ title: "Supplier created", description: s.name });
    },
    onError: (e: any) => toast({ title: "Could not create supplier", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            aria-invalid={invalid}
            className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
          >
            <span className="truncate">{value || placeholder}</span>
            <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search suppliers…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>No supplier found.</CommandEmpty>
              <CommandGroup>
                {options.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={s.name}
                    onSelect={() => {
                      onChange(s.name, s.id.startsWith("extra:") || s.id === "current" ? null : s.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("me-2 h-4 w-4", value === s.name ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{s.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup>
                <CommandItem
                  value={`__create__${search}`}
                  onSelect={() => {
                    setDraft((d) => ({ ...d, name: search }));
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="me-2 h-4 w-4" />
                  Create supplier{search ? ` “${search}”` : "…"}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New supplier</DialogTitle>
            <DialogDescription>Saved to the supplier register and selected straight away.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Vendor name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tax number</Label>
              <Input value={draft.tax_number} onChange={(e) => setDraft({ ...draft, tax_number: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={create.isPending}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || draft.name.trim().length < 2}>
              {create.isPending ? "Saving…" : "Create & select"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
