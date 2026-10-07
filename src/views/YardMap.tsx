import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ContainerRow = {
  id: string;
  container_number: string;
  status: string;
  category: string;
  size: string;
  bay: number | null;
  row: number | null;
  tier: number | null;
  block_id: string | null;
};

type BlockRow = {
  id: string;
  name: string;
  block_type: string;
  max_rows: number;
  max_bays: number;
  max_tiers: number;
  has_power: boolean;
};

const typeColors: Record<string, string> = {
  dry: "bg-muted-foreground/20",
  reefer: "bg-info/30 border-info/30",
  hazmat: "bg-destructive/30 border-destructive/30",
  mixed: "bg-warning/30 border-warning/30",
};

const statusCellColors: Record<string, string> = {
  available: "bg-success/15",
  allocated: "bg-info/15",
  damaged: "bg-destructive/15",
  repair_pending: "bg-warning/15",
  in_repair: "bg-purple-500",
  hold: "bg-gray-500",
};

export default function YardMap() {
  const { data: blocks } = useQuery({
    queryKey: ["yard-blocks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("yard_blocks").select("*").order("name");
      if (error) throw error;
      return data as BlockRow[];
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-in-yard"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, container_number, status, category, size, bay, row, tier, block_id").not("block_id", "is", null);
      if (error) throw error;
      return data as ContainerRow[];
    },
  });

  if (!blocks) return <div className="p-8 text-muted-foreground">Loading yard data...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Yard Map</h1>
        <p className="text-muted-foreground">Interactive view of all yard blocks</p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-success/15" /> Available</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-info/15" /> Allocated</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-destructive/15" /> Damaged</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-warning/15" /> Repair Pending</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-purple-500" /> In Repair</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-border bg-muted" /> Empty Slot</span>
      </div>

      {blocks.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No yard blocks configured. Add blocks in Settings to see the yard map.</CardContent></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {blocks.map((block) => {
            const blockContainers = containers?.filter((c) => c.block_id === block.id) ?? [];
            const capacity = block.max_rows * block.max_bays;
            const occupancy = blockContainers.length;
            const pct = capacity > 0 ? Math.round((occupancy / capacity) * 100) : 0;

            return (
              <Card key={block.id} className={cn("border", typeColors[block.block_type])}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">{block.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize text-xs">{block.block_type}</Badge>
                      {block.has_power && <Badge variant="secondary" className="text-xs">⚡ Power</Badge>}
                      <span className="text-xs text-muted-foreground">{pct}% full</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(block.max_bays, 20)}, 1fr)` }}>
                    {Array.from({ length: Math.min(block.max_rows * block.max_bays, 200) }).map((_, idx) => {
                      const bay = (idx % block.max_bays) + 1;
                      const row = Math.floor(idx / block.max_bays) + 1;
                      const container = blockContainers.find((c) => c.bay === bay && c.row === row);
                      return (
                        <Tooltip key={idx}>
                          <TooltipTrigger asChild>
                            <div className={cn(
"aspect-square rounded-[2px] border border-border/30 transition-colors cursor-pointer hover:ring-1 hover:ring-primary",
                              container ? statusCellColors[container.status] : "bg-muted/50"
                            )} />
                          </TooltipTrigger>
                          <TooltipContent>
                            {container ? (
                              <div className="text-xs">
                                <div className="font-mono font-bold">{container.container_number}</div>
                                <div className="capitalize">{container.status} · {container.category} · {container.size}'</div>
                                <div>Bay {bay} Row {row}</div>
                              </div>
                            ) : (
                              <div className="text-xs">Empty · Bay {bay} Row {row}</div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
