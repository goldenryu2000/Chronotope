import { z } from 'zod'

/**
 * Every licence an image in Chronotope is published under, and where its terms
 * are.
 *
 * CC BY and CC BY-SA require a link to the licence, not just its name, so the
 * caption links here. `null` means there is no licence text to link: public
 * domain, and Commons' "Copyrighted free use" template, whose file page the
 * caption already links as the source.
 *
 * The list is closed on purpose. A new licence has to be added here by someone
 * who has read it, and a non-commercial (NC) or no-derivatives (ND) licence
 * should be refused outright while a paid tier is on the roadmap.
 */
export const LICENCES = {
  'Public domain': null,
  'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC BY 2.5': 'https://creativecommons.org/licenses/by/2.5/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
  'CC BY-SA 2.0 kr': 'https://creativecommons.org/licenses/by-sa/2.0/kr/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  // The one GPL image (Fenris_Ledbergsstenen_20041231.jpg) is "version 2 of
  // the License, or any later version" on its Commons page.
  'GPL': 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
  'Copyrighted free use': null,
} as const satisfies Record<string, string | null>

export type Licence = keyof typeof LICENCES

export const LicenceSchema = z.enum(Object.keys(LICENCES) as [Licence, ...Licence[]])

export function licenceUrl(licence: string): string | null {
  return (LICENCES as Record<string, string | null>)[licence] ?? null
}
