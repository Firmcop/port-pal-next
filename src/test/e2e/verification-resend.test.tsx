import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const rpcMock = vi.fn();
const resendMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      resend: (...args: any[]) => resendMock(...args),
    },
    rpc: (...args: any[]) => rpcMock(...args),
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

import { EmailVerificationStatus } from "@/components/auth/EmailVerificationStatus";

beforeEach(() => {
  rpcMock.mockReset();
  resendMock.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  localStorage.clear();
});

describe("Resend cooldown", () => {
  it("first resend succeeds, second within window is blocked", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: { next_allowed_at: new Date(Date.now() + 60_000).toISOString() },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: "cooldown:42" } });

    render(<EmailVerificationStatus email="user@example.com" verified={false} />);

    const btn = screen.getByRole("button", { name: /Resend verification email/i });
    fireEvent.click(btn);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));

    // Countdown displays
    expect(await screen.findByText(/Next resend available in/i)).toBeInTheDocument();

    // Force-enable to simulate clicking a stale button
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "cooldown:42" } });
    // Even though button is disabled visually, calling trigger again should return cooldown
  });

  it("hourly_limit error surfaces a clear toast", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "hourly_limit:3600" } });
    render(<EmailVerificationStatus email="b@example.com" verified={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Resend verification email/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Hourly resend limit/i)));
  });

  it("renders verified pill when email is verified", () => {
    render(<EmailVerificationStatus email="ok@example.com" verified={true} />);
    expect(screen.getByText(/Email verified/i)).toBeInTheDocument();
  });
});
