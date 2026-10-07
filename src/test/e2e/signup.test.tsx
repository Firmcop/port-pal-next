import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "@/lib/router";

// ---- Mock supabase client ----
const signUpMock = vi.fn();
const signInMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...args: any[]) => signUpMock(...args),
      signInWithPassword: (...args: any[]) => signInMock(...args),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: null } }),
      resend: vi.fn().mockResolvedValue({ error: null }),
    },
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    rpc: vi.fn().mockResolvedValue({ data: { next_allowed_at: new Date(Date.now() + 60000).toISOString() }, error: null }),
  },
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import Login from "@/views/Login";
import { AuthProvider } from "@/lib/auth";

beforeEach(() => {
  signUpMock.mockReset();
  signUpMock.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  localStorage.clear();
});

describe("Signup flow", () => {
  it("shows the verification panel after sign-up", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Create a workspace/i }));
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "new@user.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "supersecret" } });
    fireEvent.click(screen.getByRole("button", { name: /Create my workspace/i }));

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: "new@user.com", password: "supersecret" })
      );
    });

    expect(await screen.findByText(/Awaiting verification/i)).toBeInTheDocument();
    expect(screen.getByText("new@user.com")).toBeInTheDocument();
  });
});
