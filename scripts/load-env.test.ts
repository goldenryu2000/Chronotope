import { describe, expect, it } from 'vitest'
import { envFilePath } from './load-env'

describe('envFilePath', () => {
  it('reads .env.local when nothing says otherwise', () => {
    expect(envFilePath({})).toBe('.env.local')
  })

  it('reads the file ENV_FILE names, so production is opted into rather than stumbled into', () => {
    expect(envFilePath({ ENV_FILE: '.env.deploy' })).toBe('.env.deploy')
  })
})
