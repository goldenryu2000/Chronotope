import { describe, expect, it } from 'vitest'
import { triggerDeploy } from './trigger-deploy'

const HOOK = 'https://api.vercel.com/v1/integrations/deploy/prj_abc/xyz'

describe('triggerDeploy', () => {
  it('skips without failing when no hook is configured', async () => {
    await expect(triggerDeploy(undefined)).resolves.toBe(false)
  })

  it('POSTs the hook', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return new Response('{}', { status: 201 })
    }) as typeof fetch
    await expect(triggerDeploy(HOOK, fetcher)).resolves.toBe(true)
    expect(calls).toEqual([[HOOK, { method: 'POST' }]])
  })

  it('refuses a URL that is not a Vercel deploy hook, so a typo cannot POST elsewhere', async () => {
    await expect(triggerDeploy('https://example.com/hook')).rejects.toThrow(/deploy hook/)
  })

  it('fails loudly when Vercel says no', async () => {
    const fetcher = (async () => new Response('', { status: 404 })) as typeof fetch
    await expect(triggerDeploy(HOOK, fetcher)).rejects.toThrow(/404/)
  })
})
