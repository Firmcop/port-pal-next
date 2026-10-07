import { useMemo } from "react";
import { Link, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Boxes, TrendingDown, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { formatMoney } from "@/lib/app-settings";
import { useOrgCurrency } from "@/hooks/use-org-currency";

const MOVEMENT_LABEL: Record<string, string> = {
  receipt: "Receipt",
  issue: "Issue",
  return: "Return",
  adjustment: "Adjustment",
  scrap: "Scrap",
};

export default function MaterialDetail() {
  const { id } = useParams();
  const { currency } = useOrgCurrency();

  const { data: material, isLoading } = useQuery({
    queryKey: ["material-detail", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("materials")
        .select("*, material_stock(qty_available, qty_reserved, last_updated)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: movements } = useQuery({
    queryKey: ["material-movements", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("material_movements")
        .select("*, container_conversions:conversion_id(id, conversion_number, project_id, projects:project_id(id, name))")
        .eq("material_id", id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!id,
  });

  const { data: poLines } = useQuery({
    queryKey: ["material-po-lines", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("po_items")
        .select(
          "id, quantity, unit_price, total_cost, landed_unit_cost, received_qty, created_at, purchase_orders:po_id(id, po_number, status, order_date, currency, suppliers:supplier_id(id, name))",
        )
        .eq("material_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!id,
  });

  const { data: requests } = useQuery({
    queryKey: ["material-requests", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("material_requests")
        .select("id, description, quantity, status, urgency, needed_by, created_at, purchase_order_id, container_conversions:conversion_id(id, conversion_number)")
        .eq("material_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!id,
  });

  const stock = Array.isArray(material?.material_stock) ? material?.material_stock[0] : material?.material_stock;

  /** Per-supplier cost comparison built from purchase order lines. */
  const sources = useMemo(() => {
    const map = new Map<string, any>();
    for (const l of poLines ?? []) {
      const po = l.purchase_orders;
      const sup = po?.suppliers;
      const key = sup?.id ?? "unknown";
      const cur = map.get(key) ?? {
        supplier_id: sup?.id ?? null,
        name: sup?.name ?? "Unknown supplier",
        currency: po?.currency ?? currency,
        qty: 0,
        value: 0,
        landedValue: 0,
        landedQty: 0,
        orders: 0,
        lastDate: null as string | null,
        lastUnitPrice: 0,
        min: Number.POSITIVE_INFINITY,
        max: 0,
      };
      const qty = Number(l.quantity || 0);
      const price = Number(l.unit_price || 0);
      cur.qty += qty;
      cur.value += qty * price;
      if (l.landed_unit_cost != null) {
        cur.landedValue += qty * Number(l.landed_unit_cost);
        cur.landedQty += qty;
      }
      cur.orders += 1;
      cur.min = Math.min(cur.min, price);
      cur.max = Math.max(cur.max, price);
      const d = po?.order_date ?? l.created_at;
      if (!cur.lastDate || (d && d > cur.lastDate)) {
        cur.lastDate = d;
        cur.lastUnitPrice = price;
      }
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((s) => ({
        ...s,
        avg: s.qty > 0 ? s.value / s.qty : 0,
        landedAvg: s.landedQty > 0 ? s.landedValue / s.landedQty : null,
        min: Number.isFinite(s.min) ? s.min : 0,
      }))
      .sort((a, b) => a.avg - b.avg);
  }, [poLines, currency]);

  const cheapest = sources[0];
  const dearest = sources.length > 1 ? sources[sources.length - 1] : undefined;

  /** Net consumption per conversion job / project. */
  const consumption = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of movements ?? []) {
      if (!m.conversion_id) continue;
      const job = m.container_conversions;
      const key = m.conversion_id;
      const cur = map.get(key) ?? {
        conversion_id: key,
        conversion_number: job?.conversion_number ?? "—",
        project_id: job?.project_id ?? null,
        project_name: job?.projects?.name ?? null,
        qty: 0,
        cost: 0,
        lastDate: m.created_at,
      };
      const sign = m.movement_type === "return" ? -1 : m.movement_type === "issue" || m.movement_type === "scrap" ? 1 : 0;
      if (sign !== 0) {
        cur.qty += sign * Number(m.qty || 0);
        cur.cost += sign * Number(m.qty || 0) * Number(m.unit_cost || 0);
      }
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }, [movements]);

  const totalConsumedQty = consumption.reduce((s, c) => s + c.qty, 0);
  const totalConsumedCost = consumption.reduce((s, c) => s + c.cost, 0);
  const totalReceivedQty = (movements ?? [])
    .filter((m) => m.movement_type === "receipt")
    .reduce((s, m) => s + Number(m.qty || 0), 0);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!material) return <div className="p-8 text-muted-foreground">Material not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/materials"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2 truncate">
            <Boxes className="h-6 w-6 shrink-0" />{material.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {material.category ?? "Uncategorised"} · per {material.unit} ·{" "}
            <Badge variant={material.is_active ? "default" : "secondary"}>{material.is_active ? "Active" : "Archived"}</Badge>
            {material.is_vatable ? <> · VAT applicable</> : null}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Available</p><p className="text-xl font-mono">{Number(stock?.qty_available ?? 0).toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Reserved</p><p className="text-xl font-mono">{Number(stock?.qty_reserved ?? 0).toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Avg unit cost</p><p className="text-xl font-mono">{formatMoney(material.avg_unit_cost ?? material.unit_cost, currency)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Received to date</p><p className="text-xl font-mono">{totalReceivedQty.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Consumed to date</p><p className="text-xl font-mono">{totalConsumedQty.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">{formatMoney(totalConsumedCost, currency)}</p></CardContent></Card>
      </div>

      {(cheapest || dearest) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cheapest && (
            <Card className="border-success/40">
              <CardContent className="p-4 flex items-center gap-3">
                <TrendingDown className="h-5 w-5 text-success" />
                <div><p className="text-xs text-muted-foreground">Cheapest source</p><p className="text-sm font-medium">{cheapest.name}</p></div>
                <p className="ml-auto font-mono">{formatMoney(cheapest.avg, cheapest.currency)}</p>
              </CardContent>
            </Card>
          )}
          {dearest && (
            <Card className="border-destructive/40">
              <CardContent className="p-4 flex items-center gap-3">
                <TrendingUp className="h-5 w-5 text-destructive" />
                <div><p className="text-xs text-muted-foreground">Most expensive source</p><p className="text-sm font-medium">{dearest.name}</p></div>
                <p className="ml-auto font-mono">{formatMoney(dearest.avg, dearest.currency)}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Tabs defaultValue="sources">
        <TabsList>
          <TabsTrigger value="sources">Sources &amp; costs</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="consumption">Job / project use</TabsTrigger>
          <TabsTrigger value="procurement">Procurement</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Supplier cost comparison</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Qty ordered</TableHead>
                      <TableHead className="text-right">Avg unit price</TableHead>
                      <TableHead className="text-right">Lowest</TableHead>
                      <TableHead className="text-right">Highest</TableHead>
                      <TableHead className="text-right">Avg landed</TableHead>
                      <TableHead>Last order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!sources.length ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No purchase history for this material yet.</TableCell></TableRow>
                    ) : sources.map((s) => (
                      <TableRow key={s.supplier_id ?? s.name}>
                        <TableCell className="font-medium">
                          {s.supplier_id ? <Link className="hover:underline" to="/suppliers">{s.name}</Link> : s.name}
                        </TableCell>
                        <TableCell className="text-right font-mono">{s.orders}</TableCell>
                        <TableCell className="text-right font-mono">{s.qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(s.avg, s.currency)}</TableCell>
                        <TableCell className="text-right font-mono text-success">{formatMoney(s.min, s.currency)}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">{formatMoney(s.max, s.currency)}</TableCell>
                        <TableCell className="text-right font-mono">{s.landedAvg == null ? "—" : formatMoney(s.landedAvg, s.currency)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.lastDate ? format(new Date(s.lastDate), "yyyy-MM-dd") : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Purchase order lines</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Landed</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!poLines?.length ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No purchase order lines.</TableCell></TableRow>
                    ) : poLines.map((l: any) => {
                      const po = l.purchase_orders;
                      const cur = po?.currency ?? currency;
                      return (
                        <TableRow key={l.id}>
                          <TableCell className="font-mono text-xs">
                            <Link className="hover:underline" to="/procurement">{po?.po_number ?? "—"}</Link>
                          </TableCell>
                          <TableCell>{po?.suppliers?.name ?? "—"}</TableCell>
                          <TableCell><Badge variant="secondary">{po?.status ?? "—"}</Badge></TableCell>
                          <TableCell className="text-right font-mono">{Number(l.quantity || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">{Number(l.received_qty || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(l.unit_price, cur)}</TableCell>
                          <TableCell className="text-right font-mono">{l.landed_unit_cost == null ? "—" : formatMoney(l.landed_unit_cost, cur)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{po?.order_date ? format(new Date(po.order_date), "yyyy-MM-dd") : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Reason / note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!movements?.length ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No movements recorded.</TableCell></TableRow>
                    ) : movements.map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs">{format(new Date(m.created_at), "yyyy-MM-dd HH:mm")}</TableCell>
                        <TableCell><Badge variant="secondary">{MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{Number(m.qty || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(m.unit_cost ?? 0, currency)}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(Number(m.qty || 0) * Number(m.unit_cost || 0), currency)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.conversion_id ? (
                            <Link className="hover:underline" to={`/conversions/${m.conversion_id}`}>{m.container_conversions?.conversion_number ?? "job"}</Link>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{[m.reason, m.note].filter(Boolean).join(" — ") || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consumption" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Net qty used</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!consumption.length ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">This material has not been consumed on any job.</TableCell></TableRow>
                    ) : (
                      <>
                        {consumption.map((c) => (
                          <TableRow key={c.conversion_id}>
                            <TableCell className="font-mono text-xs">
                              <Link className="hover:underline" to={`/conversions/${c.conversion_id}`}>{c.conversion_number}</Link>
                            </TableCell>
                            <TableCell>
                              {c.project_id ? (
                                <Link className="hover:underline" to={`/finance/projects/${c.project_id}`}>{c.project_name ?? "Project"}</Link>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono">{c.qty.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono">{formatMoney(c.cost, currency)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell colSpan={2} className="font-medium">Total</TableCell>
                          <TableCell className="text-right font-mono font-bold">{totalConsumedQty.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono font-bold">{formatMoney(totalConsumedCost, currency)}</TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="procurement" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Raised</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Urgency</TableHead>
                      <TableHead>Needed by</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!requests?.length ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No material requests raised.</TableCell></TableRow>
                    ) : requests.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{format(new Date(r.created_at), "yyyy-MM-dd")}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.container_conversions?.id ? (
                            <Link className="hover:underline" to={`/conversions/${r.container_conversions.id}`}>{r.container_conversions.conversion_number}</Link>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">{Number(r.quantity || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{r.urgency ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.needed_by ? format(new Date(r.needed_by), "yyyy-MM-dd") : "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{r.status}</Badge>
                          {r.purchase_order_id && <span className="ml-2 text-xs text-muted-foreground">PO raised</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
