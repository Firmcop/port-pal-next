import { z } from "zod";
import type { RegistryConfig } from "@/lib/excel-io";

const CONTAINER_STATUSES = [
  "available", "allocated", "damaged", "repair_pending", "in_repair",
  "hold", "in_conversion", "sold", "booked_for_repatriation",
] as const;
const CONTAINER_SIZES = [20, 40, 45] as const;
const CONTAINER_CATEGORIES = ["dry", "reefer", "open_top", "flat_rack", "tank"] as const;
const HEIGHT_CLASSES = ["HC", "LC"] as const;
const CUSTOMER_TYPES = ["buyer", "shipping_line", "owner", "agent"] as const;
const MATERIAL_UNITS = ["pcs", "kg", "m", "sheets", "litres"] as const;
const CONDITION_GRADES = ["A", "B", "C", "D"] as const;
const HAZARD_CLASSES = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export const containersConfig: RegistryConfig = {
  table: "containers",
  label: "Inventory",
  businessKey: "container_number",
  uniqueOn: "container_number",
  importable: true,
  deletable: true,
  // Per-row dispatcher is selected dynamically inside ImportDialog based on the row's flags.
  postImportRpc: "gate_in_imported_container",
  postImportTrigger: (r) =>
    Boolean(
      r.is_gate_in === true || r.is_gate_out === true ||
      r.gate_in_at || r.gate_out_at ||
      r.block_name || r.eir_number || r.exit_eir_number ||
      r.seal_number || r.exit_seal_number ||
      r.condition_grade || r.exit_condition_grade ||
      r.truck_plate || r.exit_truck_plate ||
      r.driver_name || r.exit_driver_name ||
      r.transporter || r.exit_transporter ||
      r.gross_weight_kg || r.ocr_match === false
    ),
  columns: [
    { key: "container_number", label: "Container #", required: true, example: "MSCU1234567" },
    { key: "size", label: "Size", type: "number", enum: CONTAINER_SIZES.map(String), required: true, example: 40 },
    { key: "category", label: "Category", enum: CONTAINER_CATEGORIES, required: true, example: "dry" },
    { key: "height_class", label: "Height (HC/LC, dry only)", enum: HEIGHT_CLASSES, example: "LC" },
    { key: "status", label: "Status", enum: CONTAINER_STATUSES, example: "available" },
    { key: "owner", label: "Owner", example: "MSC" },
    { key: "shipping_line", label: "Shipping Line", example: "Maersk" },
    { key: "iso_type", label: "ISO Type", example: "22G1" },
    { key: "weight_kg", label: "Weight (kg)", type: "number" },
    { key: "tare_weight_kg", label: "Tare (kg)", type: "number" },
    { key: "is_empty", label: "Empty?", type: "boolean", example: true },
    { key: "hazard_class", label: "Hazard Class", enum: HAZARD_CLASSES, example: "" },
    { key: "notes", label: "Notes" },
    // Gate-in (transient — handled by RPC)
    { key: "is_gate_in", label: "Gate In?", type: "boolean", transient: true, example: true },
    { key: "gate_in_at", label: "Gate In At", type: "date", transient: true, example: "2026-05-10T08:00:00" },
    { key: "block_name", label: "Yard Block", transient: true, example: "Block A" },
    { key: "bay", label: "Bay", type: "number", transient: true, example: 1 },
    { key: "row", label: "Row", type: "number", transient: true, example: 1 },
    { key: "tier", label: "Tier", type: "number", transient: true, example: 1 },
    { key: "condition_grade", label: "Condition Grade", enum: CONDITION_GRADES, transient: true, example: "A" },
    { key: "eir_number", label: "EIR # (optional)", transient: true },
    { key: "seal_number", label: "Seal #", transient: true },
    { key: "truck_plate", label: "Truck Plate", transient: true },
    { key: "driver_name", label: "Driver Name", transient: true },
    { key: "transporter", label: "Transporter", transient: true },
    { key: "gate_in_notes", label: "Gate In Notes", transient: true },
    // Gate-out (transient)
    { key: "is_gate_out", label: "Gate Out?", type: "boolean", transient: true },
    { key: "gate_out_at", label: "Gate Out At", type: "date", transient: true },
    { key: "exit_eir_number", label: "Exit EIR #", transient: true },
    { key: "exit_condition_grade", label: "Exit Condition", enum: CONDITION_GRADES, transient: true },
    { key: "exit_seal_number", label: "Exit Seal #", transient: true },
    { key: "gross_weight_kg", label: "Gross Weight (kg)", type: "number", transient: true },
    { key: "ocr_match", label: "OCR Match?", type: "boolean", transient: true },
    { key: "exit_truck_plate", label: "Exit Truck Plate", transient: true },
    { key: "exit_driver_name", label: "Exit Driver", transient: true },
    { key: "exit_transporter", label: "Exit Transporter", transient: true },
    { key: "gate_out_notes", label: "Gate Out Notes", transient: true },
    { key: "force", label: "Force (override OCR/weight)", type: "boolean", transient: true },
  ],
  editableFields: [
    { key: "status", label: "Status", enum: CONTAINER_STATUSES },
    { key: "owner", label: "Owner" },
    { key: "shipping_line", label: "Shipping Line" },
  ],
  templateExamples: [
    { container_number: "MSCU1234567", size: 40, category: "dry", height_class: "HC", status: "available", owner: "MSC", shipping_line: "Maersk", iso_type: "45G1", is_empty: true, is_gate_in: true, gate_in_at: "2026-05-10T08:00:00", block_name: "Block A", bay: 1, row: 1, tier: 1, condition_grade: "A", seal_number: "SEAL-001", truck_plate: "KAA 123A", driver_name: "John Doe", transporter: "Acme Transport" },
    { container_number: "MSCU7654321", size: 20, category: "reefer", height_class: "", status: "available", owner: "MSC", shipping_line: "Maersk", iso_type: "22R1", is_empty: true },
    { container_number: "MSCU9999999", size: 40, category: "dry", height_class: "HC", is_gate_out: true, gate_out_at: "2026-05-11T14:00:00", exit_condition_grade: "B", exit_seal_number: "SEAL-OUT-001", gross_weight_kg: 3800, ocr_match: true, exit_truck_plate: "KCC 999Z", exit_driver_name: "Jane Smith", exit_transporter: "Global Freight" },
  ],
  templateNotes: [
    "Height (HC/LC) is REQUIRED when Category is 'dry' and MUST be empty for any other category.",
    "Hazard Class (1-9) is optional; when set, the assigned Yard Block must be a hazardous zone.",
    "Reefer containers must be assigned to a yard block with power (has_power=true).",
    "Each (block, bay, row, tier) slot can hold only one container — duplicates within the upload are rejected.",
    "Gate-in: provide Gate In At + Yard Block + Bay/Row/Tier to place the container and create an EIR + movement.",
    "Gate-out: set Gate Out? = true (or fill any exit field). Container must already be gated-in. Exit EIR is auto-generated when blank.",
    "OCR Match? = false or large weight variance will be rejected unless Force = true.",
    "Gate-in and Gate-out cannot be set on the same row.",
    "Existing rows are matched by Container # and updated; new container numbers are inserted.",
  ],
};

const heightClassPreprocess = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["hc", "highcube", "high"].includes(s)) return "HC";
  if (["lc", "lowcube", "standard", "std", "low"].includes(s)) return "LC";
  return v;
}, z.enum(HEIGHT_CLASSES).nullable().optional());

export const containersSchema = z.object({
  container_number: z.string().trim().min(4).max(20),
  size: z.number().refine((n) => CONTAINER_SIZES.includes(n as any), "Size must be 20, 40, or 45"),
  category: z.enum(CONTAINER_CATEGORIES),
  height_class: heightClassPreprocess,
  status: z.enum(CONTAINER_STATUSES).optional().nullable(),
  owner: z.string().max(120).optional().nullable(),
  shipping_line: z.string().max(120).optional().nullable(),
  iso_type: z.string().max(10).optional().nullable(),
  weight_kg: z.number().nonnegative().optional().nullable(),
  tare_weight_kg: z.number().nonnegative().optional().nullable(),
  is_empty: z.boolean().optional().nullable(),
  hazard_class: z.enum(HAZARD_CLASSES).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // Gate-in (transient)
  is_gate_in: z.boolean().optional().nullable(),
  gate_in_at: z.string().optional().nullable(),
  block_name: z.string().max(120).optional().nullable(),
  bay: z.number().int().positive().optional().nullable(),
  row: z.number().int().positive().optional().nullable(),
  tier: z.number().int().positive().optional().nullable(),
  condition_grade: z.enum(CONDITION_GRADES).optional().nullable(),
  eir_number: z.string().max(40).optional().nullable(),
  seal_number: z.string().max(40).optional().nullable(),
  truck_plate: z.string().max(40).optional().nullable(),
  driver_name: z.string().max(120).optional().nullable(),
  transporter: z.string().max(120).optional().nullable(),
  gate_in_notes: z.string().max(500).optional().nullable(),
  // Gate-out (transient)
  is_gate_out: z.boolean().optional().nullable(),
  gate_out_at: z.string().optional().nullable(),
  exit_eir_number: z.string().max(40).optional().nullable(),
  exit_condition_grade: z.enum(CONDITION_GRADES).optional().nullable(),
  exit_seal_number: z.string().max(40).optional().nullable(),
  gross_weight_kg: z.number().nonnegative().optional().nullable(),
  ocr_match: z.boolean().optional().nullable(),
  exit_truck_plate: z.string().max(40).optional().nullable(),
  exit_driver_name: z.string().max(120).optional().nullable(),
  exit_transporter: z.string().max(120).optional().nullable(),
  gate_out_notes: z.string().max(500).optional().nullable(),
  force: z.boolean().optional().nullable(),
}).superRefine((val, ctx) => {
  if (val.category === "dry" && !val.height_class) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["height_class"], message: "Required for dry containers (HC or LC)" });
  }
  if (val.category !== "dry" && val.height_class) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["height_class"], message: "Must be empty for non-dry containers" });
  }
  if (val.block_name && (!val.bay || !val.row || !val.tier)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bay"], message: "Bay/Row/Tier required when Yard Block is set" });
  }
  if (val.is_gate_in && val.is_gate_out) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["is_gate_out"], message: "Cannot gate-in and gate-out on the same row" });
  }
});

export const customersConfig: RegistryConfig = {
  table: "customers",
  label: "Customers",
  businessKey: "company_name",
  uniqueOn: "organization_id,company_name",
  importable: true,
  deletable: true,
  columns: [
    { key: "company_name", label: "Company Name", required: true, example: "Acme Logistics" },
    { key: "customer_type", label: "Type", enum: CUSTOMER_TYPES, required: true, example: "buyer" },
    { key: "contact_person", label: "Contact" },
    { key: "email", label: "Email", example: "ops@acme.com" },
    { key: "phone", label: "Phone" },
    { key: "whatsapp_number", label: "WhatsApp" },
    { key: "tax_id", label: "Tax ID" },
    { key: "kra_pin", label: "KRA PIN" },
    { key: "address", label: "Address" },
    { key: "is_active", label: "Active", type: "boolean", example: true },
    { key: "notes", label: "Notes" },
  ],
  editableFields: [
    { key: "is_active", label: "Active status", type: "boolean" },
    { key: "customer_type", label: "Customer type", enum: CUSTOMER_TYPES },
  ],
};

export const customersSchema = z.object({
  company_name: z.string().trim().min(1).max(200),
  customer_type: z.enum(CUSTOMER_TYPES),
  contact_person: z.string().max(120).optional().nullable(),
  email: z.string().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  phone: z.string().max(40).optional().nullable(),
  whatsapp_number: z.string().max(40).optional().nullable(),
  tax_id: z.string().max(60).optional().nullable(),
  kra_pin: z.string().max(60).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  is_active: z.boolean().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const suppliersConfig: RegistryConfig = {
  table: "suppliers",
  label: "Suppliers",
  businessKey: "name",
  uniqueOn: "organization_id,name",
  importable: true,
  deletable: true,
  columns: [
    { key: "name", label: "Name", required: true, example: "Steel Supply Co" },
    { key: "contact_person", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "address", label: "Address" },
    { key: "is_active", label: "Active", type: "boolean", example: true },
    { key: "notes", label: "Notes" },
  ],
  editableFields: [{ key: "is_active", label: "Active status", type: "boolean" }],
};

export const suppliersSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contact_person: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  address: z.string().max(500).optional().nullable(),
  is_active: z.boolean().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const materialsConfig: RegistryConfig = {
  table: "materials",
  label: "Materials",
  businessKey: "name",
  uniqueOn: "organization_id,name",
  importable: true,
  deletable: true,
  columns: [
    { key: "name", label: "Name", required: true, example: "Steel Plate 4x8" },
    { key: "unit", label: "Unit", enum: MATERIAL_UNITS, required: true, example: "pcs" },
    { key: "unit_cost", label: "Unit Cost", type: "number", example: 125.5 },
    { key: "category", label: "Category", example: "Steel" },
    { key: "is_active", label: "Active", type: "boolean", example: true },
  ],
  editableFields: [
    { key: "is_active", label: "Active status", type: "boolean" },
    { key: "unit", label: "Unit", enum: MATERIAL_UNITS },
  ],
};

export const materialsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.enum(MATERIAL_UNITS),
  unit_cost: z.number().nonnegative().optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  is_active: z.boolean().optional().nullable(),
});

export const trucksConfig: RegistryConfig = {
  table: "trucks_drivers",
  label: "Trucks & Drivers",
  businessKey: "truck_plate",
  uniqueOn: "organization_id,truck_plate",
  importable: true,
  deletable: true,
  columns: [
    { key: "truck_plate", label: "Plate #", required: true, example: "KAA 123A" },
    { key: "driver_name", label: "Driver Name", required: true, example: "John Doe" },
    { key: "driver_license", label: "License" },
    { key: "driver_phone", label: "Phone" },
    { key: "company", label: "Company" },
    { key: "is_active", label: "Active", type: "boolean", example: true },
    { key: "notes", label: "Notes" },
  ],
  editableFields: [{ key: "is_active", label: "Active status", type: "boolean" }],
};

export const trucksSchema = z.object({
  truck_plate: z.string().trim().min(1).max(40),
  driver_name: z.string().trim().min(1).max(120),
  driver_license: z.string().max(60).optional().nullable(),
  driver_phone: z.string().max(40).optional().nullable(),
  company: z.string().max(120).optional().nullable(),
  is_active: z.boolean().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const REGISTRIES = {
  containers: { config: containersConfig, schema: containersSchema },
  customers: { config: customersConfig, schema: customersSchema },
  suppliers: { config: suppliersConfig, schema: suppliersSchema },
  materials: { config: materialsConfig, schema: materialsSchema },
  trucks_drivers: { config: trucksConfig, schema: trucksSchema },
} as const;

export type RegistryKey = keyof typeof REGISTRIES;
