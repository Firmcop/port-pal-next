import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fromMock = vi.fn();
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/lib/i18n-locale", () => ({ applyLanguage: vi.fn(), resolveLanguageFromCountry: () => "en" }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: any) => {
    const q: any = {};
    for (const m of ["select", "eq", "order"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve(result);
    q.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        fromMock(table);
        if (table === "organization_members")
          return chain({ data: [{ organization_id: "o1", role: "admin", organizations: { id: "o1", name: "Firmcop", status: "active", trial_ends_at: null, country: "KE" } }] });
        if (table === "profiles") return chain({ data: { active_organization_id: "o1" } });
        return chain({ data: null });
      },
      rpc: vi.fn(() => Promise.resolve({ error: null })),
    },
  };
});

import { useOrganization } from "@/hooks/use-organization";

function Name({ id }: { id: string }) {
  const o = useOrganization();
  return <span data-testid={id}>{o.loading ? "…" : o.organizationName}</span>;
}

describe("useOrganization", () => {
  beforeEach(() => fromMock.mockClear());

  it("fetches once for many components on the same screen", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        {Array.from({ length: 8 }, (_, i) => <Name key={i} id={`n${i}`} />)}
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("n7").textContent).toBe("Firmcop"));
    // 3 tables (memberships, platform admins, profile) once — not 3 × 8.
    expect(fromMock).toHaveBeenCalledTimes(3);
  });
});
