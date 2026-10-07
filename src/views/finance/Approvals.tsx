import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, UserCog, Save, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";
import { STAFF_ROLES, ROLE_LABELS } from "@/lib/staff-roles";

const DOC_TYPES = ["quote", "purchase_order", "payment", "vendor_payment", "repatriation", "eir"];
const DEFAULT_THRESHOLDS: Record<string, number> = {
  quote: 500000, purchase_order: 200000, payment: 100000, vendor_payment: 100000, repatriation: 0, eir: 0,
};

const DOC_ROUTES: Record<string, (id: string) => string> = {
  quote: (id) => `/quotes?open=${id}`,
  purchase_order: (id) => `/purchase-orders?open=${id}`,
  payment: (id) => `/finance/payments?open=${id}`,
  vendor_payment: (id) => `/finance/vendor-payments?open=${id}`,
  repatriation: (id) => `/repatriations?open=${id}`,
  eir: (id) => `/eir?open=${id}`,
};

export default function Approvals() {
  const org = useOrganization();
  const { isAdmin, isOwnerOrAdmin } = useUserStaffRole();
  const qc = useQueryClient();
  const { toast } = useToast();

  // ---- Inbox queries ----
  const { data: requests } = useQuery({
    queryKey: ["approval-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approval_requests" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as any[];
    },
  });

  // ---- Settings queries ----
  const { data: policies } = useQuery({
    queryKey: ["approval-policies", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approval_policies" as any)
        .select("*")
        .eq("organization_id", org.organizationId!)
        .order("document_type");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: staff } = useQuery({
    queryKey: ["staff-with-roles", org.organizationId],
    enabled: !!org.organizationId && isOwnerOrAdmin,
    queryFn: async () => {
      const { data: members } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", org.organizationId!);
      const userIds = (members ?? []).map((m: any) => m.user_id);
      if (!userIds.length) return [];
      const [{ data: profs }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name, manager_id").in("user_id", userIds),
        supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
      ]);
      const roleMap: Record<string, string[]> = {};
      (roles ?? []).forEach((r: any) => {
        roleMap[r.user_id] = roleMap[r.user_id] ?? [];
        roleMap[r.user_id].push(r.role);
      });
      return (profs ?? []).map((p: any) => ({ ...p, roles: roleMap[p.user_id] ?? [] }));
    },
  });

  // ---- Decisions ----
  const [reviewReceiptId, setReviewReceiptId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const decide = useMutation({
    mutationFn: async ({ r, decision }: { r: any; decision: "approved" | "rejected" }) => {
      if (r.doc_type === "goods_receipt_variance") {
        const { error } = await supabase.rpc("decide_goods_receipt_variance" as any, {
          _receipt_id: r.doc_id, _decision: decision, _note: decisionNote || null,
        });
        if (error) throw error;
      } else if (DOC_TYPES.includes(r.doc_type)) {
        const { error } = await supabase.rpc("decide_approval_request" as any, {
          _request_id: r.id, _decision: decision, _notes: decisionNote || null,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("act_on_approval" as any, {
          _request_id: r.id, _decision: decision, _note: decisionNote || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-requests"] });
      qc.invalidateQueries({ queryKey: ["approval-events"] });
      setReviewReceiptId(null);
      setDecisionNote("");
      toast({ title: "Decision recorded" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ---- Reassign ----
  const [reassignTarget, setReassignTarget] = useState<any | null>(null);
  const [newAssignee, setNewAssignee] = useState("");
  const [reassignNote, setReassignNote] = useState("");

  const reassign = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reassign_approval_request" as any, {
        _request_id: reassignTarget.id, _new_assignee: newAssignee, _note: reassignNote || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-requests"] });
      qc.invalidateQueries({ queryKey: ["approval-events"] });
      setReassignTarget(null);
      setNewAssignee("");
      setReassignNote("");
      toast({ title: "Request reassigned" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ---- Policy editor ----
  const savePolicy = useMutation({
    mutationFn: async (p: any) => {
      const payload = {
        organization_id: org.organizationId,
        document_type: p.document_type,
        min_amount: Number(p.min_amount) || 0,
        required_role: p.required_role || "admin",
        limited_roles: p.limited_roles ?? [],
        enabled: p.enabled !== false,
      };
      if (p.id) {
        const { error } = await supabase.from("approval_policies" as any)
          .update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("approval_policies" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-policies"] });
      toast({ title: "Policy saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedDefaults = useMutation({
    mutationFn: async () => {
      const existing = new Set((policies ?? []).map((p: any) => p.document_type));
      const missing = DOC_TYPES.filter((d) => !existing.has(d));
      if (!missing.length) return;
      const rows = missing.map((d) => ({
        organization_id: org.organizationId,
        document_type: d,
        min_amount: DEFAULT_THRESHOLDS[d] ?? 0,
        required_role: "admin",
        limited_roles: ["viewer", "gate_clerk", "yard_operator", "accountant"],
        enabled: true,
      }));
      const { error } = await supabase.from("approval_policies" as any).insert(rows);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approval-policies"] }); toast({ title: "Defaults seeded" }); },
  });

  // ---- Manager assignment ----
  const saveManager = useMutation({
    mutationFn: async ({ user_id, manager_id }: { user_id: string; manager_id: string | null }) => {
      const { error } = await supabase.from("profiles")
        .update({ manager_id }).eq("user_id", user_id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["staff-with-roles"] }); toast({ title: "Manager updated" }); },
  });

  // Build policy view (merge missing rows)
  const policyByDoc: Record<string, any> = {};
  (policies ?? []).forEach((p: any) => (policyByDoc[p.document_type] = p));
  const policyRows = DOC_TYPES.map((d) => policyByDoc[d] ?? {
    document_type: d, min_amount: DEFAULT_THRESHOLDS[d] ?? 0, required_role: "admin",
    limited_roles: [], enabled: false,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6" />Approvals</h1>
          <p className="text-muted-foreground">Inbox, thresholds, and manager assignment.</p>
        </div>
      </div>

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          {isOwnerOrAdmin && <TabsTrigger value="settings">Settings</TabsTrigger>}
          {isOwnerOrAdmin && <TabsTrigger value="managers">Managers</TabsTrigger>}
        </TabsList>

        <TabsContent value="inbox" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doc Type</TableHead>
                    <TableHead>Doc ID</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!requests?.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No requests.</TableCell></TableRow>
                  ) : requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.doc_type}</TableCell>
                      <TableCell className="font-mono text-xs">{String(r.doc_id).slice(0, 8)}…</TableCell>
                      <TableCell className="text-right font-mono">{r.amount ? fmtMoney(r.amount) : "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className="capitalize">{r.status}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{r.assigned_to ? String(r.assigned_to).slice(0, 8) + "…" : "—"}</TableCell>
                      <TableCell className="text-right space-x-1">
                        {DOC_ROUTES[r.doc_type] && (
                          <Button asChild size="sm" variant="ghost"><a href={DOC_ROUTES[r.doc_type](r.doc_id)}>Open</a></Button>
                        )}
                        {r.status === "pending" && (
                          <>
                            {r.doc_type === "goods_receipt_variance" ? (
                              <Button size="sm" variant="outline" onClick={() => setReviewReceiptId(r.doc_id)}>Review</Button>
                            ) : (
                              <>
                                <Button size="sm" variant="outline" onClick={() => decide.mutate({ r, decision: "approved" })}>Approve</Button>
                                <Button size="sm" variant="ghost" onClick={() => decide.mutate({ r, decision: "rejected" })}>Reject</Button>
                                {isAdmin && (
                                  <Button size="sm" variant="ghost" onClick={() => setReassignTarget(r)}>
                                    <UserCog className="h-3 w-3 mr-1" />Reassign
                                  </Button>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {isOwnerOrAdmin && (
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">Approval thresholds</h2>
                    <p className="text-xs text-muted-foreground">Documents above the threshold require approval. Listed limited roles always require approval regardless of amount.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => seedDefaults.mutate()}><Plus className="h-3 w-3 mr-1" />Seed defaults</Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document type</TableHead>
                      <TableHead className="text-right">Min amount</TableHead>
                      <TableHead>Approver role</TableHead>
                      <TableHead>Limited roles (always require)</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policyRows.map((p) => <PolicyRow key={p.document_type} initial={p} onSave={(v) => savePolicy.mutate(v)} />)}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isOwnerOrAdmin && (
          <TabsContent value="managers" className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <h2 className="font-semibold">Manager assignment</h2>
                <p className="text-xs text-muted-foreground">Approval requests route to a user's assigned manager first.</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Manager</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(staff ?? []).map((u: any) => (
                      <TableRow key={u.user_id}>
                        <TableCell className="text-sm">{u.display_name || u.user_id.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {(u.roles ?? []).map((r: string) => ROLE_LABELS[r] ?? r).join(", ") || "—"}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={u.manager_id ?? "_none"}
                            onValueChange={(v) => saveManager.mutate({ user_id: u.user_id, manager_id: v === "_none" ? null : v })}
                          >
                            <SelectTrigger className="w-[260px]"><SelectValue placeholder="No manager" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">— No manager —</SelectItem>
                              {(staff ?? [])
                                .filter((m: any) => m.user_id !== u.user_id)
                                .map((m: any) => (
                                  <SelectItem key={m.user_id} value={m.user_id}>
                                    {m.display_name || m.user_id.slice(0, 8)}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Reassign dialog */}
      <Dialog open={!!reassignTarget} onOpenChange={(v) => { if (!v) { setReassignTarget(null); setNewAssignee(""); setReassignNote(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reassign approval request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>New assignee</Label>
              <Select value={newAssignee} onValueChange={setNewAssignee}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {(staff ?? []).map((m: any) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.display_name || m.user_id.slice(0, 8)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Input value={reassignNote} onChange={(e) => setReassignNote(e.target.value)} placeholder="Why are you reassigning?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignTarget(null)}>Cancel</Button>
            <Button onClick={() => reassign.mutate()} disabled={!newAssignee || reassign.isPending}>Reassign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Goods receipt review dialog left as-is via reviewReceiptId fallback */}
      <Dialog open={!!reviewReceiptId} onOpenChange={(v) => { if (!v) { setReviewReceiptId(null); setDecisionNote(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review goods receipt variance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Decision note</Label>
              <Input value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => decide.mutate({ r: { id: "", doc_type: "goods_receipt_variance", doc_id: reviewReceiptId }, decision: "rejected" })}>Reject</Button>
              <Button onClick={() => decide.mutate({ r: { id: "", doc_type: "goods_receipt_variance", doc_id: reviewReceiptId }, decision: "approved" })}>Approve</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PolicyRow({ initial, onSave }: { initial: any; onSave: (v: any) => void }) {
  const [row, setRow] = useState(initial);
  const limited: string[] = row.limited_roles ?? [];
  const toggleRole = (r: string) =>
    setRow({ ...row, limited_roles: limited.includes(r) ? limited.filter((x) => x !== r) : [...limited, r] });

  return (
    <TableRow>
      <TableCell className="text-xs font-mono">{row.document_type}</TableCell>
      <TableCell className="text-right">
        <Input type="number" className="w-32 ml-auto text-right" value={row.min_amount}
          onChange={(e) => setRow({ ...row, min_amount: e.target.value })} />
      </TableCell>
      <TableCell>
        <Select value={row.required_role || "admin"} onValueChange={(v) => setRow({ ...row, required_role: v })}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["admin", "sales_manager", "supply_chain_manager", "accountant", "hr_manager", "mr_supervisor"].map((r) => (
              <SelectItem key={r} value={r}>{ROLE_LABELS[r] ?? r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1 max-w-[280px]">
          {STAFF_ROLES.map((r) => (
            <Badge key={r}
              variant={limited.includes(r) ? "default" : "outline"}
              className="cursor-pointer text-[10px]" onClick={() => toggleRole(r)}>
              {ROLE_LABELS[r] ?? r}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell><Switch checked={row.enabled !== false} onCheckedChange={(v) => setRow({ ...row, enabled: v })} /></TableCell>
      <TableCell><Button size="sm" variant="outline" onClick={() => onSave(row)}><Save className="h-3 w-3" /></Button></TableCell>
    </TableRow>
  );
}
