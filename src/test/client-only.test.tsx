import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { ClientOnly } from '@/components/shared/client-only'

describe('ClientOnly', () => {
  it('на серверном рендере не отдаёт детей — гидратация без расхождений', () => {
    const html = renderToString(
      <ClientOnly>
        <span>график</span>
      </ClientOnly>,
    )

    expect(html).toBe('')
  })

  it('после монтирования показывает детей', async () => {
    render(
      <ClientOnly>
        <span>график</span>
      </ClientOnly>,
    )

    expect(await screen.findByText('график')).toBeInTheDocument()
  })
})
