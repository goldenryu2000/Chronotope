import { afterEach, describe, expect, it, vi } from 'vitest'
import nextConfig, { contentSecurityPolicy, originOf, productionEnvProblems, securityHeaders } from './next.config'

const prod = { dev: false, https: true, assetOrigins: ['https://assets.example.com'] }
const byKey = (options: typeof prod) =>
  Object.fromEntries(securityHeaders(options).map(({ key, value }) => [key, value]))

describe('originOf', () => {
  it('takes the origin of an absolute URL', () => {
    expect(originOf('https://assets.example.com/artifacts')).toBe('https://assets.example.com')
  })

  it('treats a path, or nothing, as this origin', () => {
    expect(originOf('/artifacts')).toBeNull()
    expect(originOf(undefined)).toBeNull()
  })
})

describe('contentSecurityPolicy', () => {
  it('lets the browser fetch artifacts and tiles from the asset origin', () => {
    expect(contentSecurityPolicy(prod)).toContain("connect-src 'self' https://assets.example.com")
  })

  it('refuses framing, plugins, foreign form posts and a rewritten base', () => {
    const csp = contentSecurityPolicy(prod)
    for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "form-action 'self'", "base-uri 'self'"]) {
      expect(csp).toContain(directive)
    }
  })

  it('allows eval and the HMR socket in development only', () => {
    expect(contentSecurityPolicy(prod)).not.toMatch(/unsafe-eval|ws:/)
    const dev = contentSecurityPolicy({ ...prod, dev: true, https: false })
    expect(dev).toContain("'unsafe-eval'")
    expect(dev).toContain('ws:')
  })

  it('upgrades insecure requests only when served over HTTPS, or `next start` on http breaks', () => {
    expect(contentSecurityPolicy(prod)).toContain('upgrade-insecure-requests')
    expect(contentSecurityPolicy({ ...prod, https: false })).not.toContain('upgrade-insecure-requests')
  })
})

describe('securityHeaders', () => {
  it('always sends the static hardening headers', () => {
    const headers = byKey({ ...prod, https: false })
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Permissions-Policy']).toContain('geolocation=()')
  })

  it('pins HTTPS only over HTTPS, and never opts into the preload list', () => {
    expect(byKey({ ...prod, https: false })['Strict-Transport-Security']).toBeUndefined()
    expect(byKey(prod)['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains')
  })
})

describe('next.config', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('hides the framework and sends the headers on every path', async () => {
    vi.stubEnv('NEXT_PUBLIC_TILES_BASE_URL', 'https://assets.example.com')
    expect(nextConfig.poweredByHeader).toBe(false)
    const [rule] = await nextConfig.headers!()
    expect(rule.source).toBe('/:path*')
    expect(rule.headers.find((h) => h.key === 'Content-Security-Policy')!.value)
      .toContain('https://assets.example.com')
  })
})

describe('productionEnvProblems', () => {
  // A made-up connection string, for its shape only. The pre-commit secret
  // scan would otherwise refuse it.
  const complete = {
    // secretlint-disable-next-line
    DATABASE_URL: 'postgresql://chronotope_app:x@ep-a-pooler.ap-southeast-1.aws.neon.tech/neondb',
    NEXT_PUBLIC_ARTIFACT_BASE_URL: 'https://assets.example.com/artifacts',
    NEXT_PUBLIC_TILES_BASE_URL: 'https://assets.example.com',
    NEXT_PUBLIC_SOURCE_URL: 'https://github.com/someone/chronotope',
  }

  it('passes a complete production environment', () => {
    expect(productionEnvProblems(complete)).toEqual([])
  })

  it('catches the local artifact path, which would 404 every atlas on Vercel', () => {
    expect(productionEnvProblems({ ...complete, NEXT_PUBLIC_ARTIFACT_BASE_URL: '/artifacts' }))
      .toEqual(['NEXT_PUBLIC_ARTIFACT_BASE_URL must be an https URL'])
  })

  it('lists everything missing at once', () => {
    expect(productionEnvProblems({})).toHaveLength(4)
  })
})
