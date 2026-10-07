import { supabase } from "@/integrations/supabase/client";

const BUCKET = "container-photos";
const SIGN_TTL_SECONDS = 60 * 60; // 1 hour

/** Extracts the storage path from either a bare path or a legacy public URL. */
export function toStoragePath(value: string): string {
  if (!value) return value;
  const marker = `/${BUCKET}/`;
  const idx = value.indexOf(marker);
  if (idx >= 0) return value.slice(idx + marker.length).split("?")[0];
  return value;
}

/** Upload a file and return its storage path (NOT a public URL). */
export async function uploadContainerPhoto(file: File, prefix = "eir"): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

/** Mint a short-lived signed URL for a stored container photo (path or legacy URL). */
export async function signContainerPhoto(value: string): Promise<string | null> {
  const path = toStoragePath(value);
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Sign many photos, preserving order; failed entries become null. */
export async function signContainerPhotos(values: string[]): Promise<string[]> {
  const out = await Promise.all(values.map((v) => signContainerPhoto(v)));
  return out.filter((u): u is string => !!u);
}
