import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "@/lib/router";

const useOrgMock = vi.fn();
vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => useOrgMock(),
}));

import { TrialBanner } from "@/components/TrialBanner";
import { FreeTierBanner } from "@/components/FreeTierBanner";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function trialOrg(daysFromNow: number) {
  return {
    loading: false,
    organizationId: "org-1",
    organizationName: "Test",
    status: "trial",
    trialEndsAt: new Date(Date.now() + daysFromNow * 86400_000).toISOString(),
    role: "org_owner",
    isPlatformAdmin: false,
    needsOnboarding: false,
  };
}

describe("Trial countdown", () => {
  it("shows days + hours when more than 1 day remains", () => {
    useOrgMock.mockReturnValue(trialOrg(14));
    render(<MemoryRouter><TrialBanner /></MemoryRouter>);
    expect(screen.getByText(/14 days/i)).toBeInTheDocument();
    expect(screen.getByText(/free trial/i)).toBeInTheDocument();
  });

  it("flips to red 'Trial ended' once countdown passes zero", () => {
    useOrgMock.mockReturnValue(trialOrg(0.0001)); // ~9 seconds
    const { container } = render(<MemoryRouter><TrialBanner /></MemoryRouter>);

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(screen.getByText(/Trial ended/i)).toBeInTheDocument();
    expect(container.querySelector(".text-destructive")).toBeTruthy();
  });

  it("renders nothing when org status is not trial", () => {
    useOrgMock.mockReturnValue({ ...trialOrg(14), status: "active" });
    const { container } = render(<MemoryRouter><TrialBanner /></MemoryRouter>);
    expect(container.textContent).toBe("");
  });
});

describe("FreeTierBanner", () => {
  it("appears when org is on the Free plan", () => {
    useOrgMock.mockReturnValue({ ...trialOrg(0), status: "free" });
    render(<MemoryRouter><FreeTierBanner /></MemoryRouter>);
    expect(screen.getByText(/Free plan/i)).toBeInTheDocument();
    expect(screen.getByText(/Upgrade/i)).toBeInTheDocument();
  });

  it("does not render for trial accounts", () => {
    useOrgMock.mockReturnValue(trialOrg(14));
    const { container } = render(<MemoryRouter><FreeTierBanner /></MemoryRouter>);
    expect(container.textContent).toBe("");
  });
});
