import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useOrgCurrency } from "@/hooks/use-org-currency";

const CURRENCIES = ["USD", "KES", "EUR", "UGX", "TZS", "GBP"];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new carrier id once created. */
  onCreated?: (carrierId: string) => void;
};

/**
 * Create a logistics carrier inline. A carrier is normally also a payable
 * supplier, so we either link an existing supplier or create one alongside.
 */
export function CreateCarrierDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currency: orgCurrency } = useOrgCurrency();

  const [name, setName] = useState("");
  const [type, setType] = useState<"internal" | "subcontractor">("subcontractor");
  const [currency, setCurrency] = useState(orgCurrency || "USD");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [supplierMode, setSupplierMode] = useState<"create" | "existing" | "none">("create");
  const [supplierId, setSupplierId] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("subcontractor");
    setCurrency(orgCurrency || "USD");
    setPhone("");
    setEmail("");
    setSupplierMode("create");
    setSupplierId("");
  }, [open, orgCurrency]);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-pick"],
    enabled: open,
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Carrier name is required");
      let linkedSupplier: string | null = supplierMode === "existing" ? supplierId || null : null;

      if (supplierMode === "create") {
        const { data: sup, error: supErr } = await supabase
          .from("suppliers")
          .insert({ name: name.trim(), phone: phone || null, email: email || null } as any)
          .select("id")
          .single();
        if (supErr) throw supErr;
        linkedSupplier = sup.id;
      }

      const { data, error } = await supabase
        .from("logistics_carriers")
        .insert({
          name: name.trim(),
          type,
          default_currency: currency,
          contact_phone: phone || null,
          contact_email: email || null,
          supplier_id: linkedSupplier,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["logistics-carriers-active"] });
      qc.invalidateQueries({ queryKey: ["suppliers-pick"] });
      toast({ title: "Carrier created" });
      onCreated?.(id);
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Could not create carrier", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New carrier</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gataru Enterprises" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="subcontractor">Subcontractor</SelectItem>
                  <SelectItem value="internal">Internal fleet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Billing currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          <div>
            <Label>Supplier record</Label>
            <Select value={supplierMode} onValueChange={(v) => setSupplierMode(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="create">Create a matching supplier</SelectItem>
                <SelectItem value="existing">Link an existing supplier</SelectItem>
                <SelectItem value="none">No supplier link</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {supplierMode === "existing" && (
            <div>
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {(suppliers as any[]).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !name.trim() || (supplierMode === "existing" && !supplierId)}
          >
            {create.isPending ? "Creating…" : "Create carrier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
