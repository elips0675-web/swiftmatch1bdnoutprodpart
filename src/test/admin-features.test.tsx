import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const t = (key: string) => key

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t, language: 'ru', setLanguage: () => {} }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/token', () => ({ getToken: vi.fn(() => 'admin-token') }))

import FeatureFlagsPage from '@/pages/admin-features'
import { toast } from 'sonner'
import { getToken } from '@/lib/token'

const flags = {
  videoCalls: true, aiIcebreakers: true, aiCompatibility: true, groupsPage: true,
  contest: true, showAds: false, autosearch: true, hangouts: true,
  partnerOffers: false, profileActivity: true, rolloutPercent: 30,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cleanup()
  vi.mocked(getToken).mockReturnValue('admin-token')
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => flags }))
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.clearAllMocks()
})

const waitForSwitches = async () => {
  await waitFor(() => expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0))
}

describe('FeatureFlagsPage rollout', () => {
  it('рисует rollout из API и шлёт его в PUT', async () => {
    render(<FeatureFlagsPage />)
    await waitFor(() => expect(screen.getByTestId('rollout-percent')).toBeTruthy())
    expect((screen.getByTestId('rollout-percent') as HTMLInputElement).value).toBe('30')
    expect(screen.getByText('30% users')).toBeTruthy()

    fireEvent.change(screen.getByTestId('rollout-percent'), { target: { value: '50' } })
    fireEvent.click(screen.getByTestId('save-features'))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect((screen.getByTestId('save-features') as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/features', { headers: { Authorization: 'Bearer admin-token' } })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/features', expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('"rolloutPercent":50'),
    }))
  })

  it('количество затронутых пользователей зависит от роллаута', async () => {
    render(<FeatureFlagsPage />)
    await waitFor(() => expect(screen.getByTestId('rollout-percent')).toBeTruthy())
    expect(screen.getAllByText(/744 users/).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/12480/)).toHaveLength(0)
  })

  it('без rolloutPercent в ответе роллаут равен 100', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({}) }))
    render(<FeatureFlagsPage />)
    await waitFor(() => expect(screen.getByTestId('rollout-percent')).toBeTruthy())
    expect((screen.getByTestId('rollout-percent') as HTMLInputElement).value).toBe('100')
  })

  it('роллаут зажимается в 0..100 и не пропускает нечисло', async () => {
    render(<FeatureFlagsPage />)
    await waitFor(() => expect(screen.getByTestId('rollout-percent')).toBeTruthy())
    const input = screen.getByTestId('rollout-percent') as HTMLInputElement

    fireEvent.change(input, { target: { value: '150' } })
    expect(input.value).toBe('100')

    fireEvent.change(input, { target: { value: '-5' } })
    expect(input.value).toBe('0')

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('0')
  })

  it('без токена запрос идёт без заголовка Authorization', async () => {
    vi.mocked(getToken).mockReturnValue(null)
    render(<FeatureFlagsPage />)
    await waitFor(() => expect(screen.getByTestId('rollout-percent')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/features', { headers: {} })

    fireEvent.change(screen.getByTestId('rollout-percent'), { target: { value: '40' } })
    fireEvent.click(screen.getByTestId('save-features'))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/features', expect.objectContaining({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    }))
  })
})

describe('FeatureFlagsPage сохранение и сброс', () => {
  it('ошибка загрузки показывает тост и оставляет список пустым', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({}) }))
    render(<FeatureFlagsPage />)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('admin.error.load'))
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.getByTestId('rollout-percent')).toBeTruthy()
  })

  it('переключатель меняет флаг, сброс возвращает сохранённое состояние', async () => {
    render(<FeatureFlagsPage />)
    await waitForSwitches()

    const save = screen.getByTestId('save-features') as HTMLButtonElement
    const reset = screen.getByTestId('reset-features') as HTMLButtonElement
    const video = screen.getByLabelText('admin.features.video_calls')

    expect(save.disabled).toBe(true)
    expect(reset.disabled).toBe(true)
    expect(video.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(video)

    fireEvent.change(screen.getByTestId('rollout-percent'), { target: { value: '55' } })

    expect(video.getAttribute('aria-checked')).toBe('false')
    expect(save.disabled).toBe(false)
    expect(reset.disabled).toBe(false)

    fireEvent.click(reset)

    expect(toast.info).toHaveBeenCalledWith('admin.features.reset')
    expect(video.getAttribute('aria-checked')).toBe('true')
    expect((screen.getByTestId('rollout-percent') as HTMLInputElement).value).toBe('30')
    expect(save.disabled).toBe(true)
  })

  it('после успешного сохранения сброс возвращает уже сохранённое значение', async () => {
    render(<FeatureFlagsPage />)
    await waitForSwitches()

    const video = screen.getByLabelText('admin.features.video_calls')
    fireEvent.click(video)
    expect(video.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByTestId('save-features'))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('reset-features'))

    expect(video.getAttribute('aria-checked')).toBe('false')
    expect((screen.getByTestId('save-features') as HTMLButtonElement).disabled).toBe(true)
  })

  it('отказ сервера при сохранении не считается успехом', async () => {
    render(<FeatureFlagsPage />)
    await waitForSwitches()

    fireEvent.change(screen.getByTestId('rollout-percent'), { target: { value: '50' } })
    fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({}) }))
    fireEvent.click(screen.getByTestId('save-features'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('admin.error.save'))
    expect(toast.success).not.toHaveBeenCalled()
    expect((screen.getByTestId('save-features') as HTMLButtonElement).disabled).toBe(false)
  })
})
