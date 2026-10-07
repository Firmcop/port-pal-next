export const STAFF_ROLES = [
  "admin",
  "yard_operator",
  "gate_clerk",
  "viewer",
  "accountant",
  "hr_manager",
  "production_manager",
  "procurement_officer",
  "supply_chain_manager",
  "sales_manager",
  "leasing_manager",
  "mr_supervisor",
  "asset_manager",
] as const;

export type StaffRoleCode = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  yard_operator: "Yard Operator",
  gate_clerk: "Gate Clerk",
  viewer: "Viewer",
  customer: "Customer (Portal)",
  accountant: "Accountant",
  hr_manager: "HR Manager",
  production_manager: "Production Manager",
  procurement_officer: "Procurement Officer",
  supply_chain_manager: "Supply Chain Manager",
  sales_manager: "Sales Manager",
  leasing_manager: "Leasing Manager",
  mr_supervisor: "M&R Supervisor",
  asset_manager: "Asset Manager",
};

// Higher number = higher precedence when picking a single "primary" role
export const ROLE_PRIORITY: Record<string, number> = {
  admin: 100,
  accountant: 60,
  hr_manager: 60,
  production_manager: 60,
  procurement_officer: 60,
  supply_chain_manager: 60,
  sales_manager: 60,
  leasing_manager: 60,
  mr_supervisor: 60,
  asset_manager: 60,
  yard_operator: 30,
  gate_clerk: 20,
  viewer: 10,
  customer: 0,
};
