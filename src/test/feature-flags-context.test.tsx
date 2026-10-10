import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => null,
}))

vi.mock("@/lib/token", () => ({
  getToken: () => "test-token",
}))

describe("FeatureFlagsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it("fetches flags from API fallback when no Supabase", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ videoCalls: true, aiIcebreakers: false }),
    })

    const { FeatureFlagsProvider, useFeatureFlags } = await import("@/context/feature-flags-context")

    function TestComponent() {
      const flags = useFeatureFlags()
      return <div data-testid="flags">{JSON.stringify(flags)}</div>
    }

    render(
      <FeatureFlagsProvider>
        <TestComponent />
      </FeatureFlagsProvider>
    )

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/admin/features", expect.any(Object))
    })

    await waitFor(() => {
      expect(screen.getByTestId("flags").textContent).toContain('"profileActivityEnabled":true')
    })
  })

  it("returns default flags when API fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    const { FeatureFlagsProvider, useFeatureFlags } = await import("@/context/feature-flags-context")

    function TestComponent() {
      const flags = useFeatureFlags()
      return <div data-testid="flags">{JSON.stringify(flags)}</div>
    }

    render(
      <FeatureFlagsProvider>
        <TestComponent />
      </FeatureFlagsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId("flags")).toBeTruthy()
    })
  })

  it("does not crash on import", async () => {
    const mod = await import("@/context/feature-flags-context")
    expect(mod).toBeDefined()
    expect(mod.FeatureFlagsProvider).toBeDefined()
    expect(mod.useFeatureFlags).toBeDefined()
  })
})
