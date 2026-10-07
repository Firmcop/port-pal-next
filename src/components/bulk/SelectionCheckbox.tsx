import { Checkbox } from "@/components/ui/checkbox";

export function HeaderCheckbox({
  allSelected,
  someSelected,
  onToggle,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <Checkbox
      checked={allSelected ? true : someSelected ? "indeterminate" : false}
      onCheckedChange={onToggle}
      aria-label="Select all"
    />
  );
}

export function RowCheckbox({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={onToggle}
      aria-label="Select row"
      onClick={(e) => e.stopPropagation()}
    />
  );
}
