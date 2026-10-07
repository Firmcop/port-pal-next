import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, ClipboardCheck, Printer } from "lucide-react";
import { printInspectionReport } from "@/lib/document-templates";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";

const gradeColors: Record<string, string> = {
  A: "bg-success/15 text-success border-success/30",
  B: "bg-info/15 text-info border-info/30",
  C: "bg-warning/15 text-warning border-warning/30",
  D: "bg-destructive/15 text-destructive border-destructive/30",
};

const typeLabels: Record<string, string> = {
  gate_in: "Gate In",
  periodic: "Periodic",
  pre_delivery: "Pre-Delivery",
  damage: "Damage",
};

function generateNumber(prefix: string) {
  const d = new Date();
  return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}

export default function Inspections() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: inspections, isLoading } = useQuery({
    queryKey: ["inspections", search],
    queryFn: async () => {
      let q = supabase
        .from("inspections")
        .select("*, containers(container_number)")
        .order("created_at", { ascending: false });
      if (search) q = q.ilike("inspection_number", `%${search}%`);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-for-inspection"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, container_number").order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const createInspection = useMutation({
    mutationFn: async (form: any) => {
      const { error } = await supabase.from("inspections").insert({
        ...form,
        inspection_number: generateNumber("INS"),
        inspected_by: user?.id,
      });
      if (error) throw error;
      // If requires repair, update container status
      if (form.requires_repair && form.container_id) {
        await supabase.from("containers").update({ status: "repair_pending" as any }).eq("id", form.container_id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inspections"] });
      toast({ title: "Inspection recorded" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<any>({
    container_id: "",
    inspection_type: "damage",
    findings: "",
    condition_grade: "A",
    requires_repair: false,
    inspector_notes: "",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.inspections")}</h1>
          <p className="text-muted-foreground">{inspections?.length ?? 0} inspection records</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />New Inspection</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Record Inspection</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createInspection.mutate(form); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Container</Label>
                  <Select value={form.container_id} onValueChange={(v) => set("container_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                    <SelectContent>
                      {containers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.container_number}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Inspection Type</Label>
                  <Select value={form.inspection_type} onValueChange={(v) => set("inspection_type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gate_in">Gate In</SelectItem>
                      <SelectItem value="periodic">Periodic</SelectItem>
                      <SelectItem value="pre_delivery">Pre-Delivery</SelectItem>
                      <SelectItem value="damage">Damage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Condition Grade</Label>
                  <Select value={form.condition_grade} onValueChange={(v) => set("condition_grade", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A — Excellent</SelectItem>
                      <SelectItem value="B">B — Good</SelectItem>
                      <SelectItem value="C">C — Fair</SelectItem>
                      <SelectItem value="D">D — Poor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end space-x-2 pb-1">
                  <Checkbox
                    id="requires_repair"
                    checked={form.requires_repair}
                    onCheckedChange={(v) => set("requires_repair", !!v)}
                  />
                  <Label htmlFor="requires_repair">Requires Repair</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Findings</Label>
                <Textarea value={form.findings} onChange={(e) => set("findings", e.target.value)} placeholder="Describe inspection findings..." />
              </div>
              <div className="space-y-2">
                <Label>Inspector Notes</Label>
                <Textarea value={form.inspector_notes} onChange={(e) => set("inspector_notes", e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={createInspection.isPending}>Record Inspection</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search inspection number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inspection #</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Repair?</TableHead>
                <TableHead>Findings</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : !inspections?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No inspections recorded</TableCell></TableRow>
              ) : (
                inspections.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm font-medium">{r.inspection_number}</TableCell>
                    <TableCell className="font-mono text-sm">{r.containers?.container_number ?? "—"}</TableCell>
                    <TableCell>{typeLabels[r.inspection_type] ?? r.inspection_type}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={gradeColors[r.condition_grade] ?? ""}>{r.condition_grade}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.requires_repair ? (
                        <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">Yes</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">No</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.findings ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "PPp")}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => printInspectionReport({
                        inspection_number: r.inspection_number,
                        inspection_type: r.inspection_type,
                        condition_grade: r.condition_grade,
                        requires_repair: r.requires_repair,
                        findings: r.findings,
                        inspector_notes: r.inspector_notes,
                        photos: r.photos as string[] | undefined,
                        created_at: r.created_at,
                        container_number: r.containers?.container_number,
                      })}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
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
