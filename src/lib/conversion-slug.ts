/**
 * TypeScript mirror of the SQL function `public.customer_slug_for_conversion`.
 *
 * Keep this in lock-step with:
 *   supabase/migrations/20260716141351_*_customer_slug_for_conversion.sql
 *
 * Given a customer's raw display name, produce the token used as the middle
 * segment of a conversion job number (`CNV-<TOKEN>-<SEQ>`).
 *
 *   - Strips diacritics (Latin-1 Supplement + Latin Extended-A)
 *   - Uppercases and collapses non-alphanumerics to spaces
 *   - Skips leading noise words (THE, MR, MRS, MS, DR, M) when more remains
 *   - Truncates the first surviving token to 12 chars
 *   - Falls back to `NOCUST` when no customer / empty name is supplied
 *   - Falls back to `CUST<xxxxxx>` (deterministic hex from customerId) when
 *     the name contains no latin alphanumerics (e.g. non-latin scripts)
 */

const NOISE_WORDS = new Set(["THE", "MS", "MRS", "MR", "DR", "M"]);

// Minimal diacritic-stripping map covering the ranges Postgres `unaccent`
// handles for realistic Latin-script customer names.
const DIACRITIC_MAP: Record<string, string> = {
  À: "A", Á: "A", Â: "A", Ã: "A", Ä: "A", Å: "A", Ā: "A", Ă: "A", Ą: "A",
  à: "a", á: "a", â: "a", ã: "a", ä: "a", å: "a", ā: "a", ă: "a", ą: "a",
  Ç: "C", Ć: "C", Č: "C", Ĉ: "C", Ċ: "C",
  ç: "c", ć: "c", č: "c", ĉ: "c", ċ: "c",
  Ď: "D", Đ: "D", ď: "d", đ: "d",
  È: "E", É: "E", Ê: "E", Ë: "E", Ē: "E", Ĕ: "E", Ė: "E", Ę: "E", Ě: "E",
  è: "e", é: "e", ê: "e", ë: "e", ē: "e", ĕ: "e", ė: "e", ę: "e", ě: "e",
  Ĝ: "G", Ğ: "G", Ġ: "G", Ģ: "G",
  ĝ: "g", ğ: "g", ġ: "g", ģ: "g",
  Ĥ: "H", Ħ: "H", ĥ: "h", ħ: "h",
  Ì: "I", Í: "I", Î: "I", Ï: "I", Ĩ: "I", Ī: "I", Ĭ: "I", Į: "I", İ: "I",
  ì: "i", í: "i", î: "i", ï: "i", ĩ: "i", ī: "i", ĭ: "i", į: "i", ı: "i",
  Ĵ: "J", ĵ: "j",
  Ķ: "K", ķ: "k",
  Ĺ: "L", Ļ: "L", Ľ: "L", Ŀ: "L", Ł: "L",
  ĺ: "l", ļ: "l", ľ: "l", ŀ: "l", ł: "l",
  Ñ: "N", Ń: "N", Ņ: "N", Ň: "N", Ŋ: "N",
  ñ: "n", ń: "n", ņ: "n", ň: "n", ŋ: "n",
  Ò: "O", Ó: "O", Ô: "O", Õ: "O", Ö: "O", Ø: "O", Ō: "O", Ŏ: "O", Ő: "O",
  ò: "o", ó: "o", ô: "o", õ: "o", ö: "o", ø: "o", ō: "o", ŏ: "o", ő: "o",
  Ŕ: "R", Ŗ: "R", Ř: "R", ŕ: "r", ŗ: "r", ř: "r",
  Ś: "S", Ŝ: "S", Ş: "S", Š: "S", ś: "s", ŝ: "s", ş: "s", š: "s", ß: "ss",
  Ţ: "T", Ť: "T", Ŧ: "T", ţ: "t", ť: "t", ŧ: "t",
  Ù: "U", Ú: "U", Û: "U", Ü: "U", Ũ: "U", Ū: "U", Ŭ: "U", Ů: "U", Ű: "U", Ų: "U",
  ù: "u", ú: "u", û: "u", ü: "u", ũ: "u", ū: "u", ŭ: "u", ů: "u", ű: "u", ų: "u",
  Ŵ: "W", ŵ: "w",
  Ý: "Y", Ŷ: "Y", Ÿ: "Y", ý: "y", ŷ: "y", ÿ: "y",
  Ź: "Z", Ż: "Z", Ž: "Z", ź: "z", ż: "z", ž: "z",
  Æ: "AE", æ: "ae", Œ: "OE", œ: "oe",
};

function unaccent(input: string): string {
  let out = "";
  for (const ch of input) {
    out += DIACRITIC_MAP[ch] ?? ch;
  }
  return out;
}

function fallbackFromCustomerId(customerId?: string | null): string {
  if (!customerId) return "NOCUST";
  const hex = customerId.replace(/-/g, "").toUpperCase();
  if (!hex) return "NOCUST";
  return "CUST" + hex.slice(0, 6);
}

export function customerSlugForConversion(
  name: string | null | undefined,
  customerId?: string | null,
): string {
  if (customerId === undefined && (name === null || name === undefined)) {
    return "NOCUST";
  }

  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    // Matches SQL: no customer row / null name → NOCUST regardless of id
    return customerId ? fallbackFromCustomerId(customerId) : "NOCUST";
  }

  const norm = unaccent(trimmed)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  if (!norm) return fallbackFromCustomerId(customerId);

  const parts = norm.split(" ");
  let token = parts[0];
  const rest = parts.slice(1).join(" ").trim();

  if (NOISE_WORDS.has(token) && rest) {
    token = rest.split(" ")[0];
  }

  token = token.replace(/[^A-Z0-9]/g, "");
  if (!token) return fallbackFromCustomerId(customerId);

  return token.slice(0, 12);
}
