import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { presence, type ActiveEntity } from '../data/entitySpan'
import { measureInsets, type Occupancy } from '../layout/measure'
import { GAP, reveal, type Rect } from '../layout/safeArea'
import { cameraDuration } from '../lib/motion'
import { formatYear } from '../lib/year'
import { clusterCaption, clusterMove, layoutPins, type Cluster, type Placed } from './declutter'

/** How far inside the clear area a revealed pin or popover comes to rest. */
const REVEAL_MARGIN = GAP

/** The union of the boxes an element and its visible parts paint. */
function paintedBox(elements: (Element | null)[]): Rect | null {
  const boxes = elements
    .filter((element): element is Element => element !== null)
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0)
  if (boxes.length === 0) return null
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  }
}

// The ported build inlined its own BCE/CE formatter here; src/lib/year.ts now
// owns that, along with the reasoning about why years are plain signed integers.
function formatYears(start: number, end: number): string {
  return `${formatYear(start)} – ${formatYear(end)}`
}

/**
 * Draws entity pins as HTML markers and handles clusters with a smart zoom + popover model.
 */
export class EntityMarkers {
  private readonly pins = new Map<string, { marker: Marker; element: HTMLButtonElement }>()
  private readonly clusters = new Map<string, { marker: Marker; element: HTMLButtonElement }>()

  private popoverMarker: Marker | null = null
  private popoverElement: HTMLElement | null = null
  private activePopoverClusterId: string | null = null
  private activePopoverEntityIds = new Set<string>()

  private entities: readonly ActiveEntity[] = []
  private year = 0
  private selectedId: string | null = null
  private frame = 0

  constructor(
    private readonly map: MapLibreMap,
    private readonly onSelect: (id: string) => void,
  ) {
    this.map.on('zoom', this.scheduleRelayout)
    window.addEventListener('keydown', this.onKeyDown)
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.dismissPopover()
  }

  update(visible: readonly ActiveEntity[], year: number, selectedId: string | null): void {
    this.entities = visible
    this.year = year
    this.selectedId = selectedId

    // Close popover if its cluster entities are no longer active in this year/pack
    if (
      this.activePopoverEntityIds.size > 0 &&
      !visible.some((entity) => this.activePopoverEntityIds.has(entity.id))
    ) {
      this.closePopover()
    } else if (this.popoverElement) {
      // Sync active state in open popover
      const items = this.popoverElement.querySelectorAll('.cluster-popover__item')
      for (const el of items) {
        const htmlEl = el as HTMLElement
        htmlEl.dataset.selected = String(htmlEl.dataset.entityId === selectedId)
      }
    }

    this.relayout()
  }

  /** Collapse any expanded popover — used when the map background is clicked. */
  collapse(): void {
    this.dismissPopover()
  }

  /** Closes the list and redraws, so its cluster stops looking open. */
  private dismissPopover(): void {
    if (!this.popoverMarker) return
    this.closePopover()
    this.relayout()
  }

  private closePopover(): void {
    if (this.popoverMarker) {
      this.popoverMarker.remove()
      this.popoverMarker = null
    }
    this.popoverElement = null
    this.activePopoverClusterId = null
    this.activePopoverEntityIds.clear()
  }

  private scheduleRelayout = () => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.relayout()
    })
  }

  private relayout(): void {
    const { placed, clusters } = layoutPins(
      this.entities,
      (entity) => this.map.project([entity.lng, entity.lat]),
      this.selectedId,
    )

    this.syncPins(placed)
    this.syncClusters(clusters)
    this.syncPopover(clusters)
  }

  private syncPins(placed: Placed[]): void {
    const wanted = new Set(placed.map((item) => item.entity.id))

    for (const [id, entry] of this.pins) {
      if (!wanted.has(id)) {
        entry.marker.remove()
        this.pins.delete(id)
      }
    }

    for (const item of placed) {
      let entry = this.pins.get(item.entity.id)

      if (!entry) {
        const element = this.createPin(item.entity)
        const marker = new Marker({ element, anchor: 'center' })
          .setLngLat([item.entity.lng, item.entity.lat])
          .addTo(this.map)
        entry = { marker, element }
        this.pins.set(item.entity.id, entry)
      }

      const dx = item.at.x - item.anchor.x
      const dy = item.at.y - item.anchor.y
      entry.marker.setOffset([dx, dy])

      entry.element.style.setProperty('--leader', `${Math.round(Math.hypot(dx, dy))}px`)
      entry.element.style.setProperty('--leader-angle', `${Math.atan2(dy, dx) + Math.PI}rad`)
      entry.element.dataset.offset = String(item.offset)
      entry.element.dataset.label = item.label ? 'show' : 'hide'
      entry.element.dataset.side = item.side

      const selected = item.entity.id === this.selectedId
      entry.element.dataset.selected = String(selected)
      entry.element.style.opacity = selected ? '1' : String(presence(item.entity, this.year))
    }
  }

  private syncClusters(clusters: Cluster[]): void {
    const wanted = new Set(clusters.map((cluster) => cluster.id))

    for (const [id, entry] of this.clusters) {
      if (!wanted.has(id)) {
        entry.marker.remove()
        this.clusters.delete(id)
      }
    }

    for (const cluster of clusters) {
      let entry = this.clusters.get(cluster.id)

      if (!entry) {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = 'cluster'
        element.innerHTML = `<span class="cluster__count">${cluster.members.length}</span>`
        // Who is in it, beside the count, drawn like a pin's name. Built as a
        // node rather than in the markup above: names are data, not HTML.
        const label = document.createElement('span')
        label.className = 'cluster__label'
        element.append(label)

        element.addEventListener('click', (event) => {
          event.stopPropagation()
          // Zoom when more zoom parts the members, list them when nothing
          // the map allows would. See `clusterMove` in declutter.ts.
          const move = clusterMove(cluster.members, this.map.getZoom(), this.map.getMaxZoom())
          if (move.kind === 'zoom') {
            // Framed inside the clear area, so the members it spreads out do
            // not land under the panel or behind the dock.
            const { insets } = measureInsets()
            const clearance = REVEAL_MARGIN * 2
            this.map.fitBounds(cluster.bounds, {
              padding: {
                top: insets.top + clearance,
                right: insets.right + clearance,
                bottom: insets.bottom + clearance,
                left: insets.left + clearance,
              },
              maxZoom: move.zoom,
              duration: cameraDuration(600),
            })
            this.closePopover()
            return
          }

          // Otherwise, toggle the location popover card
          if (this.activePopoverClusterId === cluster.id) {
            this.dismissPopover()
          } else {
            this.openPopover(cluster)
          }
        })

        const marker = new Marker({ element, anchor: 'center' })
          .setLngLat(cluster.lngLat)
          .addTo(this.map)

        entry = { marker, element }
        this.clusters.set(cluster.id, entry)
      } else {
        entry.marker.setLngLat(cluster.lngLat)
        const countSpan = entry.element.querySelector('.cluster__count')
        if (countSpan) countSpan.textContent = String(cluster.members.length)
      }

      const label = entry.element.querySelector('.cluster__label')
      if (label) label.textContent = cluster.name
      entry.element.dataset.label = cluster.label ? 'show' : 'hide'
      entry.element.dataset.side = cluster.side

      const caption = clusterCaption(cluster.members.length, cluster.place)
      entry.element.setAttribute(
        'aria-label',
        `${caption}: ${cluster.members.map((m) => m.name).join(', ')}`,
      )
      entry.element.setAttribute('title', caption)
      // Lit while its list is open, and while it holds whoever the panel shows:
      // the cluster is the only mark on the map for a figure picked from it.
      entry.element.dataset.active = String(
        this.activePopoverClusterId === cluster.id ||
          cluster.members.some((member) => member.id === this.selectedId),
      )
    }
  }

  private syncPopover(clusters: Cluster[]): void {
    if (!this.activePopoverClusterId || this.activePopoverEntityIds.size === 0) return

    // Find cluster at current zoom sharing members with popover or holding selected entity
    const activeCluster = clusters.find(
      (c) =>
        c.members.some((m) => this.activePopoverEntityIds.has(m.id)) ||
        (this.selectedId && c.members.some((m) => m.id === this.selectedId)),
    )

    if (!activeCluster) {
      // Cluster separated into single pins; close popover
      this.closePopover()
      return
    }

    // Keep active cluster reference and marker position updated
    this.activePopoverClusterId = activeCluster.id
    this.activePopoverEntityIds = new Set(activeCluster.members.map((m) => m.id))
    this.popoverMarker?.setLngLat(activeCluster.lngLat)

    // Dynamically update list content & member count on zoom
    if (this.popoverElement) {
      this.updatePopoverDOM(activeCluster)
    }
  }

  private updatePopoverDOM(cluster: Cluster): void {
    if (!this.popoverElement) return

    const title = this.popoverElement.querySelector('.cluster-popover__title')
    if (title) title.textContent = cluster.place ?? 'Nearby'

    const countBadge = this.popoverElement.querySelector('.cluster-popover__count')
    if (countBadge) countBadge.textContent = `${cluster.members.length} figures`
    this.popoverElement.setAttribute('aria-label', clusterCaption(cluster.members.length, cluster.place))

    const list = this.popoverElement.querySelector('.cluster-popover__list')
    if (!list) return

    const existingItems = Array.from(list.children) as HTMLElement[]
    const existingMap = new Map<string, HTMLElement>()
    for (const item of existingItems) {
      if (item.dataset.entityId) existingMap.set(item.dataset.entityId, item)
    }

    const newEntityIds = new Set(cluster.members.map((m) => m.id))

    // Remove members that split out of cluster
    for (const [id, item] of existingMap.entries()) {
      if (!newEntityIds.has(id)) {
        item.remove()
      }
    }

    // Add or update members
    for (const entity of cluster.members) {
      let item = existingMap.get(entity.id)
      if (!item) {
        item = this.createPopoverItem(entity)
        list.append(item)
      }
      item.dataset.selected = String(entity.id === this.selectedId)
    }
  }

  private openPopover(cluster: Cluster): void {
    this.closePopover()

    const container = document.createElement('div')
    container.className = 'cluster-popover'
    container.setAttribute('role', 'dialog')
    container.setAttribute('aria-label', clusterCaption(cluster.members.length, cluster.place))

    container.addEventListener('click', (e) => e.stopPropagation())

    // Header
    const header = document.createElement('div')
    header.className = 'cluster-popover__header'

    const titleGroup = document.createElement('div')
    titleGroup.className = 'cluster-popover__title-group'

    const title = document.createElement('h3')
    title.className = 'cluster-popover__title'
    // A place only when every member shares it; see `Cluster.place`.
    title.textContent = cluster.place ?? 'Nearby'

    const countBadge = document.createElement('span')
    countBadge.className = 'cluster-popover__count'
    countBadge.textContent = `${cluster.members.length} figures`

    titleGroup.append(title, countBadge)

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'cluster-popover__close'
    closeBtn.innerHTML = '&times;'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.addEventListener('click', () => this.dismissPopover())

    header.append(titleGroup, closeBtn)

    // List of entities
    const list = document.createElement('div')
    list.className = 'cluster-popover__list'

    for (const entity of cluster.members) {
      const item = this.createPopoverItem(entity)
      list.append(item)
    }

    container.append(header, list)

    this.popoverElement = container
    this.popoverMarker = new Marker({ element: container, anchor: 'bottom', offset: [0, -18] })
      .setLngLat(cluster.lngLat)
      .addTo(this.map)

    this.activePopoverClusterId = cluster.id
    this.activePopoverEntityIds = new Set(cluster.members.map((m) => m.id))
    this.relayout()

    // A cluster near an edge would open its list under the top bar, the panel
    // or the dock. The map moves, not the popover: it stays attached to the
    // cluster it belongs to, arrow and all.
    this.reveal(cluster.lngLat, paintedBox([container]))
  }

  /**
   * Moves the camera just far enough to bring what a coordinate paints into
   * the map's clear area: a pan when a pan can, a small zoom when the world's
   * edge will not allow one. See `reveal` in src/layout/safeArea.ts.
   */
  private reveal(lngLat: [number, number], box: Rect | null, occupancy: Occupancy = {}): void {
    if (!box) return
    const anchor = this.map.project(lngLat)
    const relative = {
      left: box.left - anchor.x,
      top: box.top - anchor.y,
      right: box.right - anchor.x,
      bottom: box.bottom - anchor.y,
    }
    const { viewport, insets } = measureInsets(occupancy)
    const center = this.map.getCenter()
    const move = reveal(
      lngLat,
      [center.lng, center.lat],
      this.map.getZoom(),
      viewport,
      insets,
      relative,
      REVEAL_MARGIN,
      this.map.getMaxZoom(),
    )
    if (!move) return
    this.map.easeTo({ ...move, duration: cameraDuration(450) })
  }

  private createPopoverItem(entity: ActiveEntity): HTMLButtonElement {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'cluster-popover__item'
    item.dataset.entityId = entity.id
    if (entity.id === this.selectedId) {
      item.dataset.selected = 'true'
    }

    const itemHeader = document.createElement('div')
    itemHeader.className = 'cluster-popover__item-header'

    const itemName = document.createElement('span')
    itemName.className = 'cluster-popover__item-name'
    itemName.textContent = entity.name

    const itemSpan = document.createElement('span')
    itemSpan.className = 'cluster-popover__item-span'
    itemSpan.textContent = formatYears(entity.start, entity.end)

    itemHeader.append(itemName, itemSpan)

    const itemBlurb = document.createElement('p')
    itemBlurb.className = 'cluster-popover__item-blurb'
    itemBlurb.textContent = entity.blurb

    item.append(itemHeader, itemBlurb)

    item.addEventListener('click', () => {
      this.onSelect(entity.id)
      // The list stays open: a reader going through a crowded place reads
      // one member after another, and reopening the cluster for each is a
      // chore. It closes on a click on the map, its close button or Escape.
      // It is kept clear of the panel the choice just opened.
      if (this.popoverElement) {
        for (const element of this.popoverElement.querySelectorAll<HTMLElement>('.cluster-popover__item')) {
          element.dataset.selected = String(element.dataset.entityId === entity.id)
        }
      }
      if (this.popoverMarker) {
        const { lng, lat } = this.popoverMarker.getLngLat()
        this.reveal([lng, lat], paintedBox([this.popoverElement]), { right: true })
      }
    })

    return item
  }

  private createPin(entity: ActiveEntity): HTMLButtonElement {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'pin'
    element.dataset.fuzzy = String(Boolean(entity.fuzzy))
    element.setAttribute('aria-label', `${entity.name}, ${entity.place}`)

    const dot = document.createElement('span')
    dot.className = 'pin__dot'

    const label = document.createElement('span')
    label.className = 'pin__label'
    label.textContent = entity.name

    element.append(dot, label)

    element.addEventListener('click', (event) => {
      event.stopPropagation()
      // A pin elsewhere is a click elsewhere on the map: the open list is done.
      this.dismissPopover()
      this.onSelect(entity.id)
      // The panel this opens takes the right column, and the pin clicked may be
      // in it. Nudge rather than recentre: the reader chose where to look.
      this.reveal([entity.lng, entity.lat], paintedBox([dot, label]), { right: true })
    })

    return element
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.map.off('zoom', this.scheduleRelayout)
    window.removeEventListener('keydown', this.onKeyDown)
    this.closePopover()
    for (const { marker } of this.pins.values()) marker.remove()
    for (const { marker } of this.clusters.values()) marker.remove()
    this.pins.clear()
    this.clusters.clear()
  }
}

