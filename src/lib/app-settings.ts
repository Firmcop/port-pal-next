/**
 * Global, reactive app-settings store.
 *
 * Single source of truth for org-wide preferences that must propagate to every
 * generated document (payslips, POs, leases, transport orders, invoices,
 * journals, exports, PDFs, etc.) without each component having to re-fetch.
 *
 * Bootstrap once via `useAppSettingsBootstrap()` (mounted in AppLayout /
 * PortalLayout). Read reactively via `useAppSettings()` or synchronously via
 * `getAppSettings()` / convenience getters.
 *
 * The store updates whenever the organizations row changes (via realtime), so
 * a Default Currency change in Settings propagates to every open page and to
 * every freshly-generated document immediately.
 */

export type WorkingDepotBrand = {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  logoUrl: string | null;
  taxId: string | null;
} | null;

export type AppSettings = {
  organizationId: string | null;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  organizationAddress: string | null;
  organizationTaxId: string | null;
  /** Depot the current user is actively working from. Documents and new
   * records default to this depot's brand/id when their own record has none. */
  workingDepotId: string | null;
  workingDepotBrand: WorkingDepotBrand;
  /** ISO 4217 code, e.g. "KES", "USD". */
  currency: string;
  /** Display symbol for the current currency, e.g. "$", "€", or "KES " when no glyph exists. */
  currencySymbol: string;
  /** Symbol placement for amounts. */
  currencyPosition: "before" | "after";
  /** Default decimal places for money formatting. */
  decimalPlaces: number;
  /** BCP-47 language tag for Intl formatters. */
  language: string;
  /** Country code (e.g. "KE") — used for locale-derived defaults. */
  country: string | null;
  /** ISO timezone, e.g. "Africa/Nairobi". */
  timezone: string;
  /** Sidebar keys under Billing & Finance hidden org-wide (display only). */
  hiddenFinanceNav: string[];
  /** Org-wide defaults pre-filled on container intake for acquisition services. */
  acquisitionDefaults: AcquisitionDefaults;
};

export type AcquisitionDefaults = {
  transportVendor: string;
  transportCost: number | null;
  /** Standard transport rate for 20ft units (org currency). */
  transportRate20: number | null;
  /** Standard transport rate for 40ft/45ft units (org currency). */
  transportRate40: number | null;
  offloadingVendor: string;
  offloadingCost: number | null;
};

export const EMPTY_ACQUISITION_DEFAULTS: AcquisitionDefaults = {
  transportVendor: "",
  transportCost: null,
  transportRate20: null,
  transportRate40: null,
  offloadingVendor: "",
  offloadingCost: null,
};



const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹",
};

export function symbolForCurrency(code: string): string {
  if (!code) return "";
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? `${code} `;
}

const DEFAULTS: AppSettings = {
  organizationId: null,
  organizationName: null,
  organizationLogoUrl: null,
  organizationAddress: null,
  organizationTaxId: null,
  workingDepotId: null,
  workingDepotBrand: null,
  currency: "USD",
  currencySymbol: "$",
  currencyPosition: "before",
  decimalPlaces: 2,
  language: typeof navigator !== "undefined" ? (navigator.language || "en") : "en",
  country: null,
  timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
  hiddenFinanceNav: [],
  acquisitionDefaults: { ...EMPTY_ACQUISITION_DEFAULTS },
};

let _state: AppSettings = { ...DEFAULTS };
const _listeners = new Set<() => void>();

function emit() {
  for (const l of Array.from(_listeners)) l();
}

export function getAppSettings(): AppSettings {
  return _state;
}

export function subscribeAppSettings(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/**
 * Patch settings — merges with current state. Re-derives `currencySymbol` when
 * `currency` changes unless an explicit symbol is supplied.
 */
export function setAppSettings(patch: Partial<AppSettings>) {
  const next: AppSettings = { ..._state, ...patch };
  if (patch.currency && !patch.currencySymbol) {
    next.currencySymbol = symbolForCurrency(next.currency);
  }
  // Skip noop updates to avoid render churn.
  let changed = false;
  for (const k of Object.keys(next) as (keyof AppSettings)[]) {
    const a = _state[k] as unknown;
    const b = next[k] as unknown;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) { changed = true; break; }
      // Arrays are equal — keep the previous reference to avoid render churn.
      (next as any)[k] = a;
      continue;
    }
    if (a !== b) { changed = true; break; }
  }
  if (!changed) return;
  _state = next;
  emit();
}

// ---- Convenience accessors ---------------------------------------------------

export const getOrgCurrency = () => _state.currency;
export const getCurrencySymbol = () => _state.currencySymbol;
export const getDecimalPlaces = () => _state.decimalPlaces;
export const getLanguage = () => _state.language;
export const getOrganizationId = () => _state.organizationId;
export const getWorkingDepotId = () => _state.workingDepotId;
export const getWorkingDepotBrand = () => _state.workingDepotBrand;
export const getHiddenFinanceNav = () => _state.hiddenFinanceNav;
export const getAcquisitionDefaults = () => _state.acquisitionDefaults;

/**
 * Returns the current working depot shaped for document/print templates.
 * Falls back to organization branding when no working depot is resolved.
 * Documents should call this instead of querying `depots` directly, so a
 * change in the header depot switcher takes effect immediately everywhere.
 */
export function getPrintDepot(): {
  name: string;
  code: string | null;
  location: string | null;
  logo_url: string | null;
  tax_id: string | null;
} | null {
  const b = _state.workingDepotBrand;
  if (b) {
    return {
      name: b.name,
      code: b.code,
      location: b.location,
      logo_url: b.logoUrl,
      tax_id: b.taxId,
    };
  }
  if (_state.organizationName || _state.organizationLogoUrl) {
    return {
      name: _state.organizationName ?? "Organization",
      code: null,
      location: _state.organizationAddress ?? null,
      logo_url: _state.organizationLogoUrl,
      tax_id: _state.organizationTaxId,
    };
  }
  return null;
}

/**
 * Format a money amount with the current org settings. Pass `currencyOverride`
 * for a record that stores its own currency (e.g. a historical invoice).
 */
export function formatMoney(amount: number | string | null | undefined, currencyOverride?: string): string {
  const code = (currencyOverride || _state.currency).toUpperCase();
  const v = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(_state.language, {
      style: "currency",
      currency: code,
      minimumFractionDigits: _state.decimalPlaces,
      maximumFractionDigits: _state.decimalPlaces,
    }).format(v);
  } catch {
    const sym = symbolForCurrency(code);
    const fixed = v.toFixed(_state.decimalPlaces);
    return _state.currencyPosition === "before" ? `${sym}${fixed}` : `${fixed} ${sym}`;
  }
}
