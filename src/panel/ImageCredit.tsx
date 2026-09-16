import { licenceUrl } from '../data/licences'

interface Props {
  image: { credit: string; licence: string; source: string }
  /** The BEM block the caller already styles: `panel__credit` or `entity__credit`. */
  block: 'panel' | 'entity'
}

/**
 * One caption for both places an image appears.
 *
 * CC BY and CC BY-SA ask for the author, a link to the source, and a link to
 * the licence. The panel and the entity page each had a copy of this caption
 * showing the licence as plain text; now there is one, and it links.
 */
export default function ImageCredit({ image, block }: Props) {
  const deed = licenceUrl(image.licence)
  return (
    <figcaption className={`${block}__credit`}>
      <a href={image.source} target="_blank" rel="noreferrer noopener">
        {image.credit}
      </a>
      {deed ? (
        <a className={`${block}__licence`} href={deed} target="_blank" rel="license noreferrer noopener">
          {image.licence}
        </a>
      ) : (
        <span className={`${block}__licence`}>{image.licence}</span>
      )}
    </figcaption>
  )
}
