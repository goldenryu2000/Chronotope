import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { isSlug } from '@/src/data/schemas'
import { db } from '@/src/db/client'
import { eraSets, packs, regions } from '@/src/db/schema'

/**
 * Decides whether this region and pack exist, before anything streams.
 *
 * The atlas page's `loading.tsx` opens a Suspense boundary, and Next sends the
 * response headers when streaming begins. A `notFound()` inside that boundary
 * therefore renders the not-found page under a **200**: right pixels, wrong
 * status, invisible to anyone reading it in a browser and wrong for everything
 * else. `loading.js` does not wrap a layout in a parent segment, so the check
 * lives here and the status is settled before the first byte goes out.
 *
 * It costs a blocked navigation of two indexed lookups. That is the price of a
 * correct status code, and the curtain covers the wait either way.
 *
 * It joins through `era_sets` rather than checking the two slugs separately,
 * because that row is what says "this pack is laid over this region" and it is
 * the same condition the landing page uses to decide what to link. Without it
 * a pack opens on any region that happens to exist, which is a page the
 * listing would never offer and nothing else would refuse.
 *
 * What it deliberately does not check is `status` and `visibility`. Those are
 * written by the importer and read by nothing, so a draft is currently served
 * like anything else; deciding what may be seen and by whom is milestone 3's
 * to settle, and this is where the `where` clause will go when it is.
 */
export default async function PackLayout({
  children,
  params,
}: LayoutProps<'/[region]/[pack]'>) {
  const { region, pack } = await params
  if (!isSlug(region) || !isSlug(pack)) notFound()

  const [found] = await db
    .select({ region: regions.id })
    .from(regions)
    .innerJoin(eraSets, eq(eraSets.regionId, regions.id))
    .innerJoin(packs, eq(eraSets.packId, packs.id))
    .where(and(eq(regions.slug, region), eq(packs.slug, pack)))
    .limit(1)

  if (!found) notFound()

  return children
}
