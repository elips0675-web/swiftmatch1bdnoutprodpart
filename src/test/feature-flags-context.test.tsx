import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const makeJwt = (userId: number) => `h.${btoa(JSON.stringify({ userId, role: 'user' }))}.s`

const mockToken = vi.hoisted(() => ({ value: 'test-token' as string | null }))

vi.mock("@/lib/token", () => ({
  getToken: () => mockToken.value,
}))

describe("FeatureFlagsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockToken.value = "test-token"
  })

  it("fetches flags from API", async () => {
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

  it("ответ без videoCalls подставляет дефолт true, остальные ключи маппятся", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ hangouts: false }),
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
      const flags = JSON.parse(screen.getByTestId("flags").textContent ?? "{}")
      expect(flags.hangoutsEnabled).toBe(false)
      expect(flags.videoCallsEnabled).toBe(true)
    })
  })

  it("showAds и quietHours включаются при активном rollout", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ showAds: true, quietHours: true, rolloutPercent: 100 }),
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
      const flags = JSON.parse(screen.getByTestId("flags").textContent ?? "{}")
      expect(flags.showAdsEnabled).toBe(true)
      expect(flags.quietHoursEnabled).toBe(true)
      expect(flags.rolloutEnabled).toBe(true)
    })
  })

  it("запрос без токена уходит без заголовка Authorization", async () => {
    mockToken.value = null
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

    const { FeatureFlagsProvider } = await import("@/context/feature-flags-context")

    render(
      <FeatureFlagsProvider>
        <div />
      </FeatureFlagsProvider>
    )

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/admin/features", { headers: {} })
    })
  })

  it("не-ok ответ API отбрасывается и флаги остаются дефолтными", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

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
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    const flags = JSON.parse(screen.getByTestId("flags").textContent ?? "{}")
    expect(flags.videoCallsEnabled).toBe(true)
    expect(flags.showAdsEnabled).toBe(false)
    expect(flags.hangoutsEnabled).toBe(true)
  })
})
