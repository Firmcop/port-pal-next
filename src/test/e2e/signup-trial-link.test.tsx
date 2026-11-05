import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "@/lib/router";

vi.stubEnv("NEXT_PUBLIC_TRIAL_SIGNUP", "1");
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("Trial signup link", () => {
  it("sends new companies to /start when trial signup is on", async () => {
    const { default: Login } = await import("@/views/Login");
    const { AuthProvider } = await import("@/lib/auth");
    render(<MemoryRouter><AuthProvider><Login /></AuthProvider></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Create a workspace/i }).getAttribute("href")).toBe("/start");
  });
});
