import { supabase } from "@/integrations/supabase/client";

const BUCKET = "rfq-attachments";
const SIGN_TTL = 60 * 60;

export async function uploadRfqAttachment(
  orgId: string,
  rfqId: string,
  file: File,
): Promise<{ path: string; name: string; size: number; contentType: string }> {
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${orgId}/${rfqId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return { path, name: file.name, size: file.size, contentType: file.type || "application/octet-stream" };
}

export async function signRfqAttachment(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function deleteRfqAttachment(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
