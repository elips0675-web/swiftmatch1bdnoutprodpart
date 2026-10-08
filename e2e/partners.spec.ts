import { test, expect } from '@playwright/test'
import { apiCall, loginViaApi } from './helpers/api'

test.describe('Partner ecosystem Wave 1 (deeplink chain)', () => {
  let adminToken: string

  test.beforeAll(async ({ request }) => {
    adminToken = await loginViaApi(request, 'admin@mail.ru', 'demo123456')
  })

  test('offers feed returns array with placement=chat', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/partners/offers?placement=chat', undefined, adminToken)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    for (const offer of res.body) {
      expect(offer.placement).toContain('chat')
    }
  })

  test('track creates click conversion and tags deeplink', async ({ request }) => {
    const offers = await apiCall(request, 'GET', '/api/partners/offers?placement=chat&category=cinema', undefined, adminToken)
    const offer = offers.body.find((o: { category: string }) => o.category === 'cinema')
    expect(offer).toBeTruthy()

    const track = await apiCall(request, 'POST', '/api/partners/track', { offer_id: offer.id }, adminToken)
    expect(track.status).toBe(200)
    expect(String(track.body.deeplink)).toContain('utm_source=swiftmatch')

    const partners = await apiCall(request, 'GET', '/api/admin/partners', undefined, adminToken)
    const partner = partners.body.find((p: { id: number }) => p.id === offer.partner_id)
    expect(partner.clicks_total).toBeGreaterThan(0)
  })

  test('paused offer is not tracked', async ({ request }) => {
    const bad = await apiCall(request, 'POST', '/api/partners/track', { offer_id: 999999 }, adminToken)
    expect(bad.status).toBe(404)
  })

  test('requires auth', async ({ request }) => {
    const res = await apiCall(request, 'GET', '/api/partners/offers')
    expect(res.status).toBe(401)
  })
})
