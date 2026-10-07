import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Download, Upload, FileSpreadsheet, ChevronDown, Trash2, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadTemplate, exportRowsToXlsx, type RegistryConfig } from "@/lib/excel-io";
import { ImportDialog } from "./ImportDialog";
import { BulkActionBar } from "./BulkActionBar";
import { BulkEditDialog } from "./BulkEditDialog";

export function RegistryActions({
  config,
  schema,
  allRows,
  selectedIds,
  onClearSelection,
}: {
  config: RegistryConfig;
  schema: z.ZodTypeAny;
  allRows?: any[];
  selectedIds?: string[];
  onClearSelection?: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const hasEditable = !!config.editableFields?.length;
  const selCount = selectedIds?.length ?? 0;

  const onBulkEditClick = () => {
    if (selCount > 0) setEditOpen(true);
    else setHintOpen(true);
  };

  return (
    <>
      {hasEditable && (
        <Button variant="outline" size="sm" onClick={onBulkEditClick}>
          <Pencil className="h-4 w-4 me-1" />
          Bulk edit{selCount > 0 ? ` (${selCount})` : ""}
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <FileSpreadsheet className="h-4 w-4 me-1" /> Excel <ChevronDown className="h-3 w-3 ms-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => downloadTemplate(config, `${config.table}-template.xlsx`)}>
            <Download className="h-4 w-4 me-2" /> Download blank template
          </DropdownMenuItem>
          {allRows && allRows.length > 0 && (
            <DropdownMenuItem
              onClick={() => downloadTemplate(config, `${config.table}-current.xlsx`, allRows)}
            >
              <Download className="h-4 w-4 me-2" /> Download with current data
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {config.importable && (
            <DropdownMenuItem onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 me-2" /> Import from Excel
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {config.importable && (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          config={config}
          schema={schema}
        />
      )}

      {hasEditable && (
        <BulkEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          config={config}
          selectedIds={selectedIds ?? []}
          onDone={onClearSelection}
        />
      )}

      <AlertDialog open={hintOpen} onOpenChange={setHintOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Select rows to bulk edit</AlertDialogTitle>
            <AlertDialogDescription>
              Tick the checkboxes on the left of each row you want to change,
              then click <strong>Bulk edit</strong> again. You can select all rows
              from the checkbox in the table header.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setHintOpen(false)}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function BulkActions({
  config,
  selectedIds,
  selectedRows,
  onClear,
}: {
  config: RegistryConfig;
  selectedIds: string[];
  selectedRows: any[];
  onClear: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportSelected = () => {
    exportRowsToXlsx(config, selectedRows, `${config.table}-selected.xlsx`);
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.from(config.table as any).delete().in("id", selectedIds);
      if (error) throw error;
      toast({ title: `${selectedIds.length} ${config.label.toLowerCase()} deleted` });
      qc.invalidateQueries();
      onClear();
      setConfirmDelete(false);
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (!selectedIds.length) return null;

  return (
    <BulkActionBar count={selectedIds.length} onClear={onClear}>
      <Button variant="outline" size="sm" onClick={exportSelected}>
        <Download className="h-4 w-4 me-1" /> Export selected
      </Button>
      {config.editableFields?.length ? (
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4 me-1" /> Bulk edit
        </Button>
      ) : null}
      {config.deletable && (
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4 me-1" /> Delete
        </Button>
      )}

      <BulkEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        config={config}
        selectedIds={selectedIds}
        onDone={onClear}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.length} {config.label.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected rows. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BulkActionBar>
  );
}
