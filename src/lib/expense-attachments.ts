import { supabase } from "@/integrations/supabase/client";

export const EXPENSE_BUCKET = "expense-receipts";

export type ExpenseAttachment = {
  id: string;
  expense_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  label: string;
  uploaded_by: string | null;
  created_at: string;
};

/** Uploads files to the private receipts bucket and records them against an expense. */
export async function uploadExpenseAttachments(
  organizationId: string,
  expenseId: string,
  files: File[],
  label = "receipt"
) {
  if (!files.length) return [];
  const { data: auth } = await supabase.auth.getUser();
  const rows: any[] = [];

  for (const file of files) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${organizationId}/${expenseId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from(EXPENSE_BUCKET).upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (upErr) throw upErr;
    rows.push({
      organization_id: organizationId,
      expense_id: expenseId,
      storage_path: path,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || null,
      label,
      uploaded_by: auth.user?.id ?? null,
    });
  }

  const { data, error } = await (supabase as any)
    .from("operating_expense_attachments")
    .insert(rows)
    .select("*");
  if (error) throw error;
  return data as ExpenseAttachment[];
}

export async function signedAttachmentUrl(path: string, seconds = 300) {
  const { data, error } = await supabase.storage.from(EXPENSE_BUCKET).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteExpenseAttachment(att: { id: string; storage_path: string }) {
  const { error } = await (supabase as any).from("operating_expense_attachments").delete().eq("id", att.id);
  if (error) throw error;
  await supabase.storage.from(EXPENSE_BUCKET).remove([att.storage_path]);
}
