import './load-env'

import { pathToFileURL } from 'node:url'

const HOOK_PREFIX = 'https://api.vercel.com/v1/integrations/deploy/'

/**
 * Rebuild production after a publish.
 *
 * Entity pages are prerendered at build, so new or edited figures are not
 * visible until the next deploy. ISR pages catch up within five minutes on
 * their own. The hook URL is a secret: anyone holding it can trigger builds.
 */
export async function triggerDeploy(url: string | undefined, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!url) {
    console.log('VERCEL_DEPLOY_HOOK_URL is not set. Redeploy from the Vercel dashboard to refresh entity pages.')
    return false
  }
  if (!url.startsWith(HOOK_PREFIX)) {
    throw new Error('VERCEL_DEPLOY_HOOK_URL does not look like a Vercel deploy hook')
  }
  const response = await fetcher(url, { method: 'POST' })
  if (!response.ok) throw new Error(`Vercel deploy hook answered ${response.status}`)
  return true
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  triggerDeploy(process.env.VERCEL_DEPLOY_HOOK_URL)
    .then((triggered) => { if (triggered) console.log('Production redeploy triggered.') })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}
