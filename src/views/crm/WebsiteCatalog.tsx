import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { toast } from "sonner";
import {
  Plus,
  ExternalLink,
  Trash2,
  Upload,
  ImagePlus,
  X,
  Globe,
  FileText,
  Copy as CopyIcon,
  Link2,
} from "lucide-react";

const PUBLIC_WEBSITE_ORIGIN =
  (process.env.NEXT_PUBLIC_PUBLIC_WEBSITE_ORIGIN as string | undefined) || "";

const BUCKET = "product-media";
const MAX_GALLERY = 12;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

type Product = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  category: string | null;
  short_description: string | null;
  long_description: string | null;
  base_price: number | null;
  currency: string | null;
  cover_image_url: string | null;
  gallery: string[];
  specs: Record<string, string>;
  source_template_id: string | null;
  is_published: boolean;
  sort_order: number;
  updated_at?: string;
};

const CATEGORIES = [
  "20ft House",
  "40ft House",
  "Bedsitter",
  "1 Bedroom",
  "2 Bedroom",
  "Office",
  "Kiosk",
  "Custom",
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

/** In-memory signed-URL cache so previews load fast without re-signing on every render. */
const signedCache = new Map<string, { url: string; expires: number }>();

async function signMedia(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const hit = signedCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) return null;
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60_000 });
  return data.signedUrl;
}

function useSignedUrl(path: string | null | undefined, bust?: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    signMedia(path).then((u) => {
      if (!cancelled) setUrl(u ? (bust ? `${u}#v=${encodeURIComponent(bust)}` : u) : null);
    });
    return () => { cancelled = true; };
  }, [path, bust]);
  return url;
}

function CoverThumb({ path, bust, className }: { path: string | null | undefined; bust?: string; className?: string }) {
  const url = useSignedUrl(path, bust);
  if (!url) {
    return (
      <div className={className ?? "h-10 w-10 rounded bg-muted flex items-center justify-center"}>
        <ImagePlus className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return <img src={url} alt="" className={className ?? "h-10 w-10 rounded object-cover border"} />;
}

function GalleryThumb({
  path,
  bust,
  onRemove,
  onSetCover,
  isCover,
}: {
  path: string;
  bust?: string;
  onRemove: () => void;
  onSetCover?: () => void;
  isCover?: boolean;
}) {
  const url = useSignedUrl(path, bust);
  return (
    <div className="relative group">
      {url ? (
        <img src={url} alt="" className="h-20 w-20 rounded object-cover border" />
      ) : (
        <div className="h-20 w-20 rounded bg-muted border" />
      )}
      {isCover && (
        <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-primary/80 text-primary-foreground rounded-b">
          Cover
        </span>
      )}
      {onSetCover && !isCover && (
        <button
          type="button"
          title="Set as cover"
          className="absolute -top-2 -left-2 bg-primary text-primary-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
          onClick={onSetCover}
        >
          <ImagePlus className="h-3 w-3" />
        </button>
      )}
      <button
        type="button"
        className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function WebsiteCatalog() {
  const { organizationId } = useOrganization();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Product> | null>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ["website-products", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        ...p,
        gallery: Array.isArray(p.gallery) ? p.gallery : [],
        specs: p.specs && typeof p.specs === "object" ? p.specs : {},
      })) as Product[];
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["website-products-templates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("quote_templates")
        .select("id, name, description, category")
        .eq("is_active", true)
        .order("name");
      return data ?? [];
    },
  });

  const togglePublish = useMutation({
    mutationFn: async (p: Product) => {
      const { error } = await supabase
        .from("products")
        .update({ is_published: !p.is_published })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["website-products"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["website-products"] });
      toast.success("Product removed");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const importFromTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      const tmpl = templates?.find((t: any) => t.id === templateId);
      if (!tmpl) throw new Error("Template not found");
      const baseSlug = slugify(tmpl.name);
      const { error } = await supabase.from("products").insert({
        name: tmpl.name,
        slug: `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`,
        category: tmpl.category ?? "Custom",
        short_description: tmpl.description ?? "",
        long_description: tmpl.description ?? "",
        source_template_id: tmpl.id,
        is_published: false,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["website-products"] });
      toast.success("Imported as draft product");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const sorted = useMemo(
    () => (products ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    [products],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6" /> Website Catalog
          </h1>
          <p className="text-muted-foreground">
            Products published here appear on your public website (e.g. firmcop.com)
            and quote requests come back here as leads.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <a href="/docs/public-website-api.md" target="_blank" rel="noreferrer">
              <FileText className="h-4 w-4 mr-1" /> API docs
            </a>
          </Button>
        <Button
          onClick={() =>
            setEditing({
              name: "",
              slug: "",
              category: "Custom",
              is_published: false,
              gallery: [],
              specs: {},
              sort_order: (sorted[sorted.length - 1]?.sort_order ?? 0) + 10,
            })
          }
        >
          <Plus className="h-4 w-4 mr-1" /> New product
        </Button>
        </div>
      </div>

      {!!templates?.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick-import from quote template</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {templates.slice(0, 12).map((t: any) => (
                <Button
                  key={t.id}
                  variant="outline"
                  size="sm"
                  onClick={() => importFromTemplate.mutate(t.id)}
                  disabled={importFromTemplate.isPending}
                >
                  <CopyIcon className="h-3 w-3 mr-1" />
                  {t.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Order</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="w-28">Published</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={7} />
              ) : !sorted.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No products yet. Create one or import from a quote template.
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs text-muted-foreground">{p.sort_order}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <CoverThumb path={p.cover_image_url} bust={p.updated_at} />
                        <div>
                          <button
                            className="font-medium hover:underline text-left"
                            onClick={() => setEditing(p)}
                          >
                            {p.name}
                          </button>
                          {p.short_description && (
                            <div className="text-xs text-muted-foreground line-clamp-1 max-w-md">
                              {p.short_description}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.category && <Badge variant="outline">{p.category}</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.base_price ? `${p.currency ?? ""} ${Number(p.base_price).toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.slug}</TableCell>
                    <TableCell>
                      <Switch
                        checked={p.is_published}
                        onCheckedChange={() => togglePublish.mutate(p)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Copy public URL"
                        disabled={!p.is_published}
                        onClick={() => {
                          const origin = PUBLIC_WEBSITE_ORIGIN || window.location.origin;
                          const u = `${origin.replace(/\/+$/, "")}/product/${p.slug}`;
                          navigator.clipboard.writeText(u);
                          toast.success("Public URL copied");
                        }}
                      >
                        <Link2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditing(p)}>
                        <Upload className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Delete "${p.name}"?`)) deleteProduct.mutate(p.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <ProductEditor
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["website-products"] });
            setEditing(null);
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ExternalLink className="h-4 w-4" /> Connecting your website
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Your website calls these public endpoints — no login required:
          </p>
          <ul className="list-disc pl-5 font-mono text-xs space-y-1">
            <li>GET&nbsp; /functions/v1/public-products-list</li>
            <li>GET&nbsp; /functions/v1/public-product-detail?slug=…</li>
            <li>POST /functions/v1/public-quote-request</li>
          </ul>
          <p>
            Open the&nbsp;
            <Link to="/leads" className="underline text-primary">Leads page</Link>
            &nbsp;to see incoming requests tagged with source “website”.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductEditor({
  value,
  onClose,
  onSaved,
}: {
  value: Partial<Product>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { organizationId } = useOrganization();
  const [form, setForm] = useState<Partial<Product>>({
    ...value,
    gallery: value.gallery ?? [],
    specs: value.specs ?? {},
  });
  const [uploading, setUploading] = useState(false);

  function patch<K extends keyof Product>(k: K, v: Product[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function uploadFile(file: File, asCover: boolean) {
    if (!organizationId) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("Only JPG, PNG or WebP images are allowed");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`Image must be smaller than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
      return;
    }
    if (!asCover && (form.gallery ?? []).length >= MAX_GALLERY) {
      toast.error(`Up to ${MAX_GALLERY} gallery images`);
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      const path = `${organizationId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
          cacheControl: "3600",
        });
      if (error) throw error;
      if (asCover) patch("cover_image_url", path);
      else patch("gallery", [...(form.gallery ?? []), path]);
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form.name?.trim()) return toast.error("Name is required");
    const slug = (form.slug || slugify(form.name)).trim();
    if (!slug) return toast.error("Slug is required");

    const payload = {
      name: form.name.trim(),
      slug,
      category: form.category ?? null,
      short_description: form.short_description ?? null,
      long_description: form.long_description ?? null,
      base_price: form.base_price ?? null,
      cover_image_url: form.cover_image_url ?? null,
      gallery: form.gallery ?? [],
      specs: form.specs ?? {},
      is_published: !!form.is_published,
      sort_order: form.sort_order ?? 0,
      // Bumping updated_at advances the cache-bust `?v=` token on the public
      // CDN URLs so updated images appear immediately on the website.
      updated_at: new Date().toISOString(),
    };

    if (form.id) {
      const { error } = await supabase.from("products").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("products").insert(payload as any);
      if (error) return toast.error(error.message);
    }
    toast.success("Saved");
    onSaved();
  }

  const specs = form.specs ?? {};
  const specEntries = Object.entries(specs);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit product" : "New product"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input
              value={form.name ?? ""}
              onChange={(e) => {
                patch("name", e.target.value);
                if (!form.id && !form.slug) patch("slug", slugify(e.target.value));
              }}
            />
          </div>
          <div>
            <Label>URL slug</Label>
            <Input
              value={form.slug ?? ""}
              onChange={(e) => patch("slug", slugify(e.target.value))}
              placeholder="40ft-1-bedroom"
            />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category ?? "Custom"} onValueChange={(v) => patch("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Base price</Label>
            <Input
              type="number"
              value={form.base_price ?? ""}
              onChange={(e) =>
                patch("base_price", e.target.value === "" ? null : Number(e.target.value))
              }
            />
          </div>
          <div className="md:col-span-2">
            <Label>Short description</Label>
            <Input
              value={form.short_description ?? ""}
              onChange={(e) => patch("short_description", e.target.value)}
              maxLength={180}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Long description</Label>
            <Textarea
              rows={5}
              value={form.long_description ?? ""}
              onChange={(e) => patch("long_description", e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <Label>Cover image</Label>
            <p className="text-xs text-muted-foreground mt-1">JPG/PNG/WebP up to 5 MB. Served via the public CDN; images auto-refresh on the website when you save.</p>
            <div className="flex items-center gap-3 mt-2">
              {form.cover_image_url && (
                <CoverThumb path={form.cover_image_url} className="h-20 w-20 rounded object-cover border" />
              )}
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], true)}
              />
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>Gallery ({(form.gallery ?? []).length}/{MAX_GALLERY})</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {(form.gallery ?? []).map((g) => (
                <GalleryThumb
                  key={g}
                  path={g}
                  isCover={form.cover_image_url === g}
                  onSetCover={() => patch("cover_image_url", g)}
                  onRemove={() => patch("gallery", (form.gallery ?? []).filter((x) => x !== g))}
                />
              ))}
            </div>
            <Input
              className="mt-2"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading || (form.gallery ?? []).length >= MAX_GALLERY}
              onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], false)}
            />
          </div>

          <div className="md:col-span-2">
            <Label>Specifications</Label>
            <div className="space-y-2 mt-1">
              {specEntries.map(([k, v], i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Spec name"
                    value={k}
                    onChange={(e) => {
                      const next = { ...specs };
                      delete next[k];
                      next[e.target.value] = v;
                      patch("specs", next);
                    }}
                  />
                  <Input
                    placeholder="Value"
                    value={v}
                    onChange={(e) => patch("specs", { ...specs, [k]: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const next = { ...specs };
                      delete next[k];
                      patch("specs", next);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch("specs", { ...specs, "": "" })}
              >
                <Plus className="h-3 w-3 mr-1" /> Add spec
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 md:col-span-2">
            <Switch
              checked={!!form.is_published}
              onCheckedChange={(v) => patch("is_published", v)}
            />
            <Label className="!mb-0">Visible on public website</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
