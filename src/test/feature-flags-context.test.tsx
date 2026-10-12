import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => null,
}))

const makeJwt = (userId: number) => `h.${btoa(JSON.stringify({ userId, role: 'user' }))}.s`

const mockToken = vi.hoisted(() => ({ value: 'test-token' }))

vi.mock("@/lib/token", () => ({
  getToken: () => mockToken.value,
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

  it("rollout: bucket вне процента скрывает включённые флаги", async () => {
    const { getRolloutBucket } = await import("@/lib/rollout")
    const { FeatureFlagsProvider, useFeatureFlags } = await import("@/context/feature-flags-context")

    function TestComponent() {
      const flags = useFeatureFlags()
      return <div data-testid="flags">{JSON.stringify(flags)}</div>
    }

    mockToken.value = makeJwt(1)
    const bucket = getRolloutBucket(1)
    const pct = bucket > 0 ? bucket - 1 : 0
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ videoCalls: true, hangouts: true, partnerOffers: true, profileActivity: true, rolloutPercent: pct }),
    })

    render(
      <FeatureFlagsProvider>
        <TestComponent />
      </FeatureFlagsProvider>
    )

    await waitFor(() => {
      const flags = JSON.parse(screen.getByTestId("flags").textContent ?? "{}")
      expect(flags.rolloutEnabled).toBe(false)
      expect(flags.hangoutsEnabled).toBe(false)
      expect(flags.partnerOffersEnabled).toBe(false)
    })
  })

  it("rollout: bucket в проценте — включённые флаги видны", async () => {
    const { getRolloutBucket } = await import("@/lib/rollout")
    const { FeatureFlagsProvider, useFeatureFlags } = await import("@/context/feature-flags-context")

    function TestComponent() {
      const flags = useFeatureFlags()
      return <div data-testid="flags">{JSON.stringify(flags)}</div>
    }

    mockToken.value = makeJwt(1)
    const pct = getRolloutBucket(1) + 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ videoCalls: true, hangouts: true, profileActivity: true, rolloutPercent: pct }),
    })

    render(
      <FeatureFlagsProvider>
        <TestComponent />
      </FeatureFlagsProvider>
    )

    await waitFor(() => {
      const flags = JSON.parse(screen.getByTestId("flags").textContent ?? "{}")
      expect(flags.rolloutEnabled).toBe(true)
      expect(flags.hangoutsEnabled).toBe(true)
    })
  })
})
