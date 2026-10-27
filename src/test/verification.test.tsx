import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { VerificationBadge, VerificationDialog } from '@/components/shared/verification'

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

const tokenState = vi.hoisted(() => ({ value: 'test-token' as string | null }))
vi.mock('@/lib/token', () => ({ getToken: () => tokenState.value }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

const fetchMock = vi.fn()

interface Submission {
  id: number
  photo_url: string
  status: string
  created_at: string
  reviewed_at: string | null
}

function statusBody(verified = false, submissions: Submission[] = []) {
  return { verified, submissions }
}

function ok(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body }
}

function fail(status: number, body: unknown = {}) {
  return { ok: false, status, json: async () => body }
}

function renderDialog(open = true) {
  const onClose = vi.fn()
  const view = render(<VerificationDialog open={open} onClose={onClose} />)
  return { onClose, ...view }
}

const pendingSubmission: Submission = {
  id: 7,
  photo_url: '/v.jpg',
  status: 'pending',
  created_at: '2026-10-27T10:00:00.000Z',
  reviewed_at: null,
}

const threeSubmissions: Submission[] = [
  { id: 1, photo_url: '/a.jpg', status: 'verified', created_at: '2026-10-25T08:00:00.000Z', reviewed_at: '2026-10-25T09:00:00.000Z' },
  { id: 2, photo_url: '/b.jpg', status: 'rejected', created_at: '2026-10-26T08:00:00.000Z', reviewed_at: '2026-10-26T09:00:00.000Z' },
  { id: 3, photo_url: '/c.jpg', status: 'pending', created_at: '2026-10-27T08:00:00.000Z', reviewed_at: null },
]

function fillPhoto(value: string) {
  const input = screen.getByPlaceholderText('verification.photo_placeholder')
  fireEvent.change(input, { target: { value } })
  return input
}

function submitButton() {
  return screen.getByText('verification.submit').closest('button') as HTMLButtonElement
}

describe('VerificationBadge', () => {
  it('не рисует бейдж без подтверждения', () => {
    const { container } = render(<VerificationBadge verified={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('рисует бейдж с переводом и добавляет переданный className', () => {
    render(<VerificationBadge verified className="ml-1" />)
    const badge = screen.getByText('verification.badge')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('ml-1')
  })

  it('не падает без className', () => {
    render(<VerificationBadge verified />)
    expect(screen.getByText('verification.badge').className).not.toContain('undefined')
  })
})

describe('VerificationDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    tokenState.value = 'test-token'
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('в закрытом состоянии не ходит в API и не рисует содержимое', () => {
    renderDialog(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('verification.title')).not.toBeInTheDocument()
  })

  it('показывает спиннер до ответа, затем описание', async () => {
    let release: (value: unknown) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    renderDialog()
    expect(screen.getByText('verification.title')).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByText('verification.description')).not.toBeInTheDocument()
    release(ok(statusBody()))
    await screen.findByText('verification.description')
    expect(document.querySelector('.animate-spin')).toBeNull()
  })

  it('читает статус с Bearer-токеном и отдаёт неверифицированную форму', async () => {
    fetchMock.mockResolvedValue(ok(statusBody()))
    renderDialog()
    await screen.findByText('verification.description')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/profile/verification')
    expect(init).toEqual({ headers: { Authorization: 'Bearer test-token' } })
    expect(screen.getByPlaceholderText('verification.photo_placeholder')).toHaveValue('')
    expect(submitButton()).toBeDisabled()
  })

  it('без токена не отправляет Authorization', async () => {
    tokenState.value = null
    fetchMock.mockResolvedValue(ok(statusBody()))
    renderDialog()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: {} })
  })

  it('пустая ссылка не включает кнопку, а заполненная включает', async () => {
    fetchMock.mockResolvedValue(ok(statusBody()))
    renderDialog()
    await screen.findByText('verification.description')
    expect(submitButton()).toBeDisabled()
    const input = fillPhoto('   ')
    expect(submitButton()).toBeDisabled()
    fireEvent.change(input, { target: { value: '  https://cdn.example/v.jpg  ' } })
    expect(submitButton()).toBeEnabled()
  })

  it('во время отправки кнопка блокируется до ответа', async () => {
    let release: (value: unknown) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
      .mockResolvedValueOnce(ok(statusBody(false, [pendingSubmission])))
    renderDialog()
    await screen.findByText('verification.description')
    fillPhoto('https://cdn.example/v.jpg')
    fireEvent.click(submitButton())
    await waitFor(() => expect(submitButton()).toBeDisabled())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    release(ok({ id: 9, status: 'pending' }, 201))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('verification.submitted'))
    expect(screen.getByPlaceholderText('verification.photo_placeholder')).toHaveValue('')
    expect(submitButton()).toBeDisabled()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })

  it('успешная отправка шлёт обрезанную ссылку с JSON-заголовком, чистит поле и обновляет историю', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockResolvedValueOnce(ok({ id: 9, status: 'pending' }, 201))
      .mockResolvedValueOnce(ok(statusBody(false, [pendingSubmission])))
    renderDialog()
    const input = await screen.findByPlaceholderText('verification.photo_placeholder')
    fireEvent.change(input, { target: { value: '  https://cdn.example/v.jpg  ' } })
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('verification.submitted'))
    const postInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(postInit.method).toBe('POST')
    expect(postInit.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    })
    expect(JSON.parse(String(postInit.body))).toEqual({ photo_url: 'https://cdn.example/v.jpg' })
    expect(input).toHaveValue('')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][1]).toEqual({ headers: { Authorization: 'Bearer test-token' } })
    await screen.findByText('verification.status_pending')
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('409 показывает перевод «уже на проверке», а не английский message, и перечитывает историю', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockResolvedValueOnce(fail(409, { message: 'Verification already pending' }))
      .mockResolvedValueOnce(ok(statusBody(false, [pendingSubmission])))
    renderDialog()
    await screen.findByText('verification.description')
    fillPhoto('https://cdn.example/v.jpg')
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('verification.already_pending'))
    expect(toastMock.error).not.toHaveBeenCalledWith('verification.submit_error')
    expect(screen.queryByText('Verification already pending')).not.toBeInTheDocument()
    await screen.findByText('verification.status_pending')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(toastMock.success).not.toHaveBeenCalled()
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })

  it('500 отдаёт общий перевод, а не английский message сервера', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockResolvedValueOnce(fail(500, { message: 'Failed to submit verification' }))
    renderDialog()
    await screen.findByText('verification.description')
    fillPhoto('https://cdn.example/v.jpg')
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('verification.submit_error'))
    expect(screen.queryByText('Failed to submit verification')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })

  it('без токена отправка, как и перечитывание, идёт без Authorization', async () => {
    tokenState.value = null
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockResolvedValueOnce(ok({ id: 9, status: 'pending' }, 201))
      .mockResolvedValueOnce(ok(statusBody(false, [pendingSubmission])))
    renderDialog()
    await screen.findByText('verification.description')
    fillPhoto('https://cdn.example/v.jpg')
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('verification.submitted'))
    const postInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(postInit.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(fetchMock.mock.calls[2][1]).toEqual({ headers: {} })
  })

  it('сетевой сбой отправки даёт общий перевод и возвращает кнопку', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockRejectedValueOnce(new Error('offline'))
    renderDialog()
    await screen.findByText('verification.description')
    fillPhoto('https://cdn.example/v.jpg')
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('verification.submit_error'))
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })

  it('сбой перечитывания после успеха не показывает ложную ошибку', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockResolvedValueOnce(ok({ id: 9, status: 'pending' }, 201))
      .mockRejectedValueOnce(new Error('offline'))
    renderDialog()
    const input = await screen.findByPlaceholderText('verification.photo_placeholder')
    fireEvent.change(input, { target: { value: 'https://cdn.example/v.jpg' } })
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('verification.submitted'))
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
  })

  it('сбой перечитывания на 409 не добавляет вторую ошибку', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockResolvedValueOnce(fail(409, { message: 'Verification already pending' }))
      .mockRejectedValueOnce(new Error('offline'))
    renderDialog()
    await screen.findByText('verification.description')
    fillPhoto('https://cdn.example/v.jpg')
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('verification.already_pending'))
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.error).not.toHaveBeenCalledWith('verification.submit_error')
  })

  it('битое тело перечитывания не стирает уже загруженный статус', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(statusBody(false, [pendingSubmission])))
      .mockResolvedValueOnce(ok({ id: 9, status: 'pending' }, 201))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
    renderDialog()
    await screen.findByText('verification.status_pending')
    fillPhoto('https://cdn.example/v.jpg')
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('verification.submitted'))
    expect(screen.getByText('verification.status_pending')).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('отказ перечитывания после успеха не подменяет статус телом ошибки', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(statusBody()))
      .mockResolvedValueOnce(ok({ id: 9, status: 'pending' }, 201))
      .mockResolvedValueOnce(fail(500, statusBody(true, [pendingSubmission])))
    renderDialog()
    await screen.findByText('verification.description')
    fillPhoto('https://cdn.example/v.jpg')
    fireEvent.click(submitButton())
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('verification.submitted'))
    expect(screen.queryByText('verification.verified_title')).not.toBeInTheDocument()
    expect(screen.getByText('verification.description')).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('подтверждённый профиль показывает успех и убирает форму отправки', async () => {
    fetchMock.mockResolvedValue(ok(statusBody(true, [threeSubmissions[0]])))
    renderDialog()
    await screen.findByText('verification.verified_title')
    expect(screen.getByText('verification.verified_desc')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('verification.photo_placeholder')).not.toBeInTheDocument()
    expect(screen.queryByText('verification.submit')).not.toBeInTheDocument()
    expect(screen.getByText('verification.status_verified')).toBeInTheDocument()
  })

  it('история показывает три статуса, свои иконки и дату в русском формате', async () => {
    fetchMock.mockResolvedValue(ok(statusBody(false, threeSubmissions)))
    renderDialog()
    await screen.findByText('verification.history')
    expect(screen.getByText('verification.status_verified')).toBeInTheDocument()
    expect(screen.getByText('verification.status_rejected')).toBeInTheDocument()
    expect(screen.getByText('verification.status_pending')).toBeInTheDocument()
    const rowIcon = (label: string) => screen.getByText(label).parentElement?.querySelector('svg')
    expect(rowIcon('verification.status_verified')?.getAttribute('class')).toContain('lucide-check')
    expect(rowIcon('verification.status_rejected')?.getAttribute('class')).toContain('lucide-x')
    expect(rowIcon('verification.status_pending')?.getAttribute('class')).toContain('lucide-clock')
    for (const item of threeSubmissions) {
      const label = new Date(item.created_at).toLocaleDateString('ru-RU')
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText(/verification\.status_/)).toHaveLength(3)
  })

  it('пустая история не рисует заголовок раздела', async () => {
    fetchMock.mockResolvedValue(ok(statusBody(false, [])))
    renderDialog()
    await screen.findByText('verification.description')
    expect(screen.queryByText('verification.history')).not.toBeInTheDocument()
  })

  it('отказ чтения статуса оставляет форму отправки, а не пустой экран', async () => {
    fetchMock.mockResolvedValue(fail(500))
    renderDialog()
    await screen.findByText('verification.description')
    expect(screen.getByPlaceholderText('verification.photo_placeholder')).toBeInTheDocument()
  })

  it('сетевой сбой чтения статуса не роняет диалог', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    renderDialog()
    await screen.findByText('verification.description')
    expect(submitButton()).toBeDisabled()
  })

  it('кнопка закрытия зовёт onClose', async () => {
    fetchMock.mockResolvedValue(ok(statusBody()))
    const { onClose } = renderDialog()
    await screen.findByText('verification.description')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
