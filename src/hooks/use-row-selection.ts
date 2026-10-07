import { useCallback, useMemo, useState } from "react";

export function useRowSelection<T extends { id: string }>(rows: T[] | undefined) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((s) => {
      const allIds = (rows ?? []).map((r) => r.id);
      if (allIds.length && allIds.every((id) => s.has(id))) return new Set();
      return new Set(allIds);
    });
  }, [rows]);

  const clear = useCallback(() => setSelected(new Set()), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const allSelected = useMemo(
    () => !!rows?.length && rows.every((r) => selected.has(r.id)),
    [rows, selected]
  );
  const someSelected = useMemo(
    () => selected.size > 0 && !allSelected,
    [selected, allSelected]
  );
  const selectedRows = useMemo(
    () => (rows ?? []).filter((r) => selected.has(r.id)),
    [rows, selected]
  );

  return {
    selected,
    selectedIds: Array.from(selected),
    selectedRows,
    count: selected.size,
    toggle,
    toggleAll,
    clear,
    isSelected,
    allSelected,
    someSelected,
  };
}
