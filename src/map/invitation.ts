import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import {
  INVITE_HIDE, INVITE_SHOW, viewportShare, type BBox,
} from '../lib/bbox'

/**
 * A plate the reader can go into, as the map offers it.
 *
 * Deliberately says nothing about regions, parents or India: a rectangle, a
 * name, a line of prose and a destination is the whole of what the engine
 * needs to offer a way deeper (Rule 3). Which plate sits inside which is
 * decided in `src/read/regionKin.ts`, from a column in the database.
 */
export interface Invite {
  /** Stable across renders; the marker is keyed on it. */
  id: string
  /** The plate's name, set as a caption. */
  title: string
  /** The plate's own words for itself, one line. */
  subtitle: string
  bbox: BBox
  /** Where clicking goes. */
  href: string
}

/** What the map currently reads as its own extent. */
function viewOf(map: MapLibreMap): BBox {
  const bounds = map.getBounds()
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
}

/**
 * Where a caption sits: the middle of the part of the plate actually on screen.
 *
 * Not the plate's own centre, which walks off the edge the moment the reader
 * zooms into a corner of it and takes the offer with it. The visible middle
 * stays put under the reader's attention, which is the only place a caption
 * for what they are looking at belongs.
 */
function captionAt(plate: BBox, view: BBox): [number, number] {
  const west = Math.max(plate[0], view[0])
  const east = Math.min(plate[2], view[2])
  const south = Math.max(plate[1], view[1])
  const north = Math.min(plate[3], view[3])
  return [(west + east) / 2, (south + north) / 2]
}

/**
 * Offers the plates inside this one, as the reader approaches them.
 *
 * **Nothing is drawn at rest.** The first design marked each plate with a
 * dashed rectangle and a boxed label, permanently: it put our clipping
 * geometry on the reader's map, competed with the historical borders that are
 * the only other lines there, and would have littered the world with one box
 * per region as more were added. It also made a claim it had no business
 * making, since a modern region's outline drawn over the year 1200 BCE is an
 * anachronism the rest of this project takes care to avoid.
 *
 * What replaces it is the gesture the reader already has. Zooming in is how
 * this atlas goes deeper, so when a plate becomes most of what somebody is
 * looking at, it says so: a caption, in type, no frame and no background,
 * reading its name over a hairline and an invitation under it. Then it fades
 * out again when they pull back. At world view the map is clean.
 *
 * It is a caption rather than a label for a reason worth keeping: a label
 * saying "India" over a map of 1200 BCE asserts something false, where "open
 * the closer atlas" is plainly the atlas talking about itself.
 *
 * This is one of two ways in, and the quieter one. The other is the menu on
 * the region's title (`src/atlas/RegionMenu.tsx`), which is always there, does
 * not need to be discovered by zooming, and scales to as many plates as there
 * ever are. This one is the reward for curiosity; that one is the map of the
 * maps.
 */
export class Invitations {
  private readonly markers = new Map<string, Marker>()
  private shown = new Set<string>()
  private invites: readonly Invite[] = []
  private frame = 0

  constructor(
    private readonly map: MapLibreMap,
    private readonly onEnter: (href: string) => void,
  ) {
    this.map.on('move', this.schedule)
  }

  /** Replaces whatever is offered. Cheap to call repeatedly. */
  update(invites: readonly Invite[]): void {
    const wanted = new Set(invites.map((invite) => invite.id))
    for (const [id, marker] of this.markers) {
      if (wanted.has(id)) continue
      marker.remove()
      this.markers.delete(id)
      this.shown.delete(id)
    }
    this.invites = invites
    this.place()
  }

  private schedule = () => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.place()
    })
  }

  private place(): void {
    if (this.invites.length === 0) return
    const view = viewOf(this.map)

    for (const invite of this.invites) {
      const share = viewportShare(invite.bbox, view)
      // Hysteresis: a single threshold makes the offer flicker for a reader
      // resting the map on the line. See INVITE_SHOW / INVITE_HIDE.
      const was = this.shown.has(invite.id)
      const now = was ? share > INVITE_HIDE : share >= INVITE_SHOW

      let marker = this.markers.get(invite.id)
      if (!marker) {
        marker = new Marker({ element: this.createSlot(invite), anchor: 'center' })
          .setLngLat(captionAt(invite.bbox, view))
          .addTo(this.map)
        this.markers.set(invite.id, marker)
      }

      const caption = marker.getElement().firstElementChild as HTMLAnchorElement
      this.writeCaption(caption, invite)

      // Only while it is being offered. Left following the map it would drag
      // a caption nobody can see across the world on every pan.
      if (now) marker.setLngLat(captionAt(invite.bbox, view))

      if (now !== was) {
        caption.dataset.shown = String(now)
        // Out of the tab order and out of the accessibility tree while it is
        // not on offer: a faded-out link is still a link to a screen reader.
        caption.setAttribute('aria-hidden', String(!now))
        caption.tabIndex = now ? 0 : -1
        if (now) this.shown.add(invite.id)
        else this.shown.delete(invite.id)
      }
    }
  }

  /** The parts that can change without the plate moving. */
  private writeCaption(element: HTMLAnchorElement, invite: Invite): void {
    element.href = invite.href
    const name = element.querySelector('.invite__name')
    if (name) name.textContent = invite.title
    const hint = element.querySelector('.invite__hint')
    if (hint) hint.textContent = invite.subtitle
    element.setAttribute('aria-label', `Open the closer atlas of ${invite.title}: ${invite.subtitle}`)
  }

  /**
   * The marker element, and the caption inside it.
   *
   * Two elements rather than one, and not for layout. MapLibre's `Marker`
   * writes `style.opacity` straight onto the element it was handed, from
   * `_updateOpacity`, on every move -- so a stylesheet cannot fade the marker
   * itself, and an inline opacity written here would be overwritten on the
   * next pan. The marker element is therefore left entirely to MapLibre and
   * everything this class styles lives one level in, where nothing else
   * writes.
   *
   * The slot is transparent to the pointer whatever it holds, so a caption
   * that is not on offer can never swallow a drag on the map.
   */
  private createSlot(invite: Invite): HTMLDivElement {
    const slot = document.createElement('div')
    slot.className = 'invite-slot'
    slot.append(this.createCaption(invite))
    return slot
  }

  private createCaption(invite: Invite): HTMLAnchorElement {
    const element = document.createElement('a')
    element.className = 'invite'
    element.dataset.invite = invite.id
    element.dataset.shown = 'false'
    element.setAttribute('aria-hidden', 'true')
    element.tabIndex = -1

    const name = document.createElement('span')
    name.className = 'invite__name'

    const rule = document.createElement('span')
    rule.className = 'invite__rule'
    rule.setAttribute('aria-hidden', 'true')

    const action = document.createElement('span')
    action.className = 'invite__action'
    action.textContent = 'Open the closer atlas'

    const hint = document.createElement('span')
    hint.className = 'invite__hint'

    element.append(name, rule, action, hint)

    element.addEventListener('click', (event) => {
      // A real href, so a modifier click opens a tab and a crawler can follow
      // it, but an ordinary click is handed to the router rather than
      // reloading the document.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      // Read off the element rather than closed over, so a handler bound when
      // the caption was created still sends the reader where it now says.
      this.onEnter(element.getAttribute('href') as string)
    })

    return element
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.map.off('move', this.schedule)
    for (const marker of this.markers.values()) marker.remove()
    this.markers.clear()
    this.shown.clear()
    this.invites = []
  }
}
