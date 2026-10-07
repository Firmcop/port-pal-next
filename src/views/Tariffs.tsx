import { getOrgCurrency } from "@/lib/app-settings";
import { CurrencySelect } from "@/components/CurrencySelect";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { HEIGHT_CLASSES, HEIGHT_CLASS_LABELS, CATEGORY_LABELS, CONTAINER_CATEGORIES } from "@/lib/container-constants";

export default function Tariffs() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sizeFilter, setSizeFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [heightFilter, setHeightFilter] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tariffs, isLoading } = useQuery({
    queryKey: ["tariffs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tariffs")
        .select("*")
        .order("container_size")
        .order("container_category")
        .order("height_class", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  const filteredTariffs = (tariffs ?? []).filter((t: any) => {
    if (sizeFilter !== "all" && String(t.container_size) !== sizeFilter) return false;
    if (categoryFilter !== "all" && t.container_category !== categoryFilter) return false;
    if (heightFilter !== "all" && t.height_class !== heightFilter) return false;
    return true;
  });

  const createTariff = useMutation({
    mutationFn: async (form: any) => {
      const { error } = await supabase.from("tariffs").insert({
        ...form,
        height_class: form.container_category === "dry" ? (form.height_class || "LC") : null,
        rate_per_day: parseFloat(form.rate_per_day),
        free_days: parseInt(form.free_days),
        gate_in_fee: form.gate_in_fee ? parseFloat(form.gate_in_fee) : 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariffs"] });
      toast({ title: "Tariff created" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("tariffs").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tariffs"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [form, setForm] = useState({
    tariff_name: "", container_size: "20", container_category: "dry", height_class: "LC",
    rate_per_day: "", free_days: "0", currency: getOrgCurrency(), gate_in_fee: "0",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Storage Tariffs</h1>
          <p className="text-muted-foreground">{tariffs?.length ?? 0} rate cards</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add Tariff</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Tariff</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createTariff.mutate(form); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Tariff Name *</Label>
                <Input value={form.tariff_name} onChange={(e) => set("tariff_name", e.target.value)} required placeholder="e.g. Standard Dry 20ft" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Container Size</Label>
                  <Select value={form.container_size} onValueChange={(v) => set("container_size", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20'</SelectItem>
                      <SelectItem value="40">40'</SelectItem>
                      <SelectItem value="45">45'</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={form.container_category} onValueChange={(v) => set("container_category", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dry">Dry</SelectItem>
                      <SelectItem value="reefer">Reefer</SelectItem>
                      <SelectItem value="tank">Tank</SelectItem>
                      <SelectItem value="flat_rack">Flat Rack</SelectItem>
                      <SelectItem value="open_top">Open Top</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.container_category === "dry" && (
                <div className="space-y-2">
                  <Label>Height Class *</Label>
                  <Select value={form.height_class} onValueChange={(v) => set("height_class", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{HEIGHT_CLASS_LABELS[h]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Rate/Day (€)</Label>
                  <Input type="number" step="0.01" min="0" value={form.rate_per_day} onChange={(e) => set("rate_per_day", e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Free Days</Label>
                  <Input type="number" min="0" value={form.free_days} onChange={(e) => set("free_days", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <CurrencySelect value={form.currency} onChange={(v) => set("currency", v)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Gate-in Fee (optional, charged on gate-in)</Label>
                <Input type="number" step="0.01" min="0" value={form.gate_in_fee} onChange={(e) => set("gate_in_fee", e.target.value)} placeholder="0.00" />
              </div>
              <Button type="submit" className="w-full" disabled={createTariff.isPending}>Create Tariff</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-3 items-end mb-3">
            <div className="space-y-1">
              <Label className="text-xs">Size</Label>
              <Select value={sizeFilter} onValueChange={setSizeFilter}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="20">20'</SelectItem>
                  <SelectItem value="40">40'</SelectItem>
                  <SelectItem value="45">45'</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); if (v !== "dry" && v !== "all") setHeightFilter("all"); }}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {CONTAINER_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Height</Label>
              <Select
                value={heightFilter}
                onValueChange={setHeightFilter}
                disabled={categoryFilter !== "all" && categoryFilter !== "dry"}
              >
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground ml-auto">{filteredTariffs.length} of {tariffs?.length ?? 0}</div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Height</TableHead>
                <TableHead className="text-right">Rate/Day</TableHead>
                <TableHead className="text-right">Free Days</TableHead>
                <TableHead className="text-right">Gate-in Fee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={9} />
              ) : !filteredTariffs.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No tariffs match these filters.</TableCell></TableRow>
              ) : (
                filteredTariffs.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.tariff_name}</TableCell>
                    <TableCell>{t.container_size}'</TableCell>
                    <TableCell>{CATEGORY_LABELS[t.container_category as keyof typeof CATEGORY_LABELS] ?? t.container_category}</TableCell>
                    <TableCell>{t.container_category === "dry" ? (t.height_class ?? "—") : "—"}</TableCell>
                    <TableCell className="text-right font-mono">€{parseFloat(t.rate_per_day).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{t.free_days}</TableCell>
                    <TableCell className="text-right font-mono">{Number(t.gate_in_fee ?? 0) > 0 ? `${t.currency} ${parseFloat(t.gate_in_fee).toFixed(2)}` : "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={t.is_active ? "bg-success/15 text-success border-success/30" : "bg-gray-500/15 text-gray-700 border-gray-300"}>
                        {t.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch checked={t.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: t.id, is_active: v })} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
