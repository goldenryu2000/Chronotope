import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/src/lib/site'

/** Everything may be crawled. The sitemap says what there is. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
