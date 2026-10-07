import { supabase } from "@/integrations/supabase/client";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(blob);
  });
}

function extractStorageObject(url: string): { bucket: string; path: string } | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const marker = "/storage/v1/object/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const objectPart = parsed.pathname.slice(markerIndex + marker.length);
    const segments = objectPart.split("/").filter(Boolean);
    if (segments.length < 3) return null;

    // public/<bucket>/<path>, authenticated/<bucket>/<path>, sign/<bucket>/<path>
    const bucket = decodeURIComponent(segments[1]);
    const path = segments.slice(2).map(decodeURIComponent).join("/");
    return bucket && path ? { bucket, path } : null;
  } catch {
    return null;
  }
}

/**
 * Convert a logo/photo URL into an inline data URL before opening a print
 * window. Private storage URLs cannot be loaded by the new window, but the
 * current authenticated app can download them and embed the bytes safely.
 */
export async function toPrintableImageUrl(url?: string | null): Promise<string> {
  if (!url) return "";
  if (url.startsWith("data:")) return url;

  const storageObject = extractStorageObject(url);
  if (storageObject) {
    const { data, error } = await supabase.storage
      .from(storageObject.bucket)
      .download(storageObject.path);
    if (!error && data) return blobToDataUrl(data);
  }

  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return url;
    return blobToDataUrl(await res.blob());
  } catch {
    return url;
  }
}

export function logoOrNameHtml(brand: { name: string; logo_url?: string | null }, logoUrl: string, style = "max-height:60px;width:auto;margin-bottom:4px;") {
  return logoUrl ? `<img src="${logoUrl}" style="${style}" />` : `<h1>${brand.name}</h1>`;
}