import { supabase } from "@/integrations/supabase/client";

export const SA_IMAGE_BUCKET = "sub-assembly-images";
export const SA_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SA_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
export type SaImageKind = "actual" | "design";
export const SA_IMAGE_KIND_LABEL: Record<SaImageKind, string> = { actual: "Actual photo", design: "Design" };

/** Returns an error message, or null when the file can be uploaded. */
export function checkSaImage(file: { type: string; size: number }): string | null {
  if (!SA_IMAGE_TYPES.includes(file.type)) return "Use a JPG, PNG, WebP, GIF or HEIC image.";
  if (file.size > SA_IMAGE_MAX_BYTES) return "The image is larger than 5 MB.";
  return null;
}

export function saImagePath(orgId: string, skuId: string, fileName: string, now = Date.now()): string {
  const ext = (fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${orgId}/${skuId}/${now}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

/** Uploads the file and points the SKU at it; removes the previous file. */
export async function setSubAssemblyImage(sku: { id: string; organization_id: string }, file: File, kind: SaImageKind) {
  const problem = checkSaImage(file);
  if (problem) throw new Error(problem);
  const path = saImagePath(sku.organization_id, sku.id, file.name);
  const { error: upErr } = await supabase.storage.from(SA_IMAGE_BUCKET).upload(path, file, { contentType: file.type });
  if (upErr) throw upErr;
  const { data: previous, error } = await (supabase as any).rpc("set_sub_assembly_image", { _id: sku.id, _path: path, _kind: kind });
  if (error) {
    await supabase.storage.from(SA_IMAGE_BUCKET).remove([path]);
    throw error;
  }
  if (previous && previous !== path) await supabase.storage.from(SA_IMAGE_BUCKET).remove([previous]);
}

/** Changes only whether the existing image is an actual photo or a design. */
export async function setSubAssemblyImageKind(sku: { id: string; image_path: string }, kind: SaImageKind) {
  const { error } = await (supabase as any).rpc("set_sub_assembly_image", { _id: sku.id, _path: sku.image_path, _kind: kind });
  if (error) throw error;
}

export async function removeSubAssemblyImage(sku: { id: string }) {
  const { data: previous, error } = await (supabase as any).rpc("set_sub_assembly_image", { _id: sku.id, _path: null, _kind: null });
  if (error) throw error;
  if (previous) await supabase.storage.from(SA_IMAGE_BUCKET).remove([previous]);
}

/** Signs many paths in one call; returns path → url. */
export async function signSaImages(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};
  const { data, error } = await supabase.storage.from(SA_IMAGE_BUCKET).createSignedUrls(unique, 60 * 60);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const d of data as any[]) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}
