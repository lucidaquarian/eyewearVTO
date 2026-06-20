import { create } from 'zustand'
import { FRAMES, DEFAULT_FRAME_ID, type Frame } from '@/vto/data/frames'
import { TINTS, DEFAULT_TINT_ID, type Tint } from '@/vto/data/tints'
import {
  deleteCustomFrame,
  listCustomFrames,
  type CustomFrameRecord,
} from '@/vto/lib/customFrames'

interface CatalogState {
  /** Id of the currently selected frame. */
  selectedFrameId: string
  /** The selected frame object (kept in sync with `selectedFrameId`). */
  selected: Frame | undefined
  /** Select a frame by id (no-op if the id isn't in the catalog). */
  setSelected: (id: string) => void

  /** USER-UPLOADED frames (IndexedDB-backed), appended after the catalog. */
  customFrames: Frame[]
  /**
   * Load persisted uploads from IndexedDB (call once on app start). Mints a
   * session blob URL per record and restores the last selection if it was a
   * custom frame.
   */
  loadCustomFrames: () => Promise<void>
  /** Register a just-uploaded record (already persisted) and select it. */
  addCustomFrame: (rec: CustomFrameRecord) => void
  /** Delete an upload: forget it, revoke its blob URL, remove from IndexedDB. */
  removeCustomFrame: (id: string) => void

  /** Id of the currently selected lens tint. */
  selectedTintId: string
  /** The selected tint object (kept in sync with `selectedTintId`). */
  selectedTint: Tint | undefined
  /** Select a lens tint by id (no-op if the id isn't in the palette). */
  setSelectedTint: (id: string) => void
}

function tintById(id: string): Tint | undefined {
  return TINTS.find((t) => t.id === id)
}

/** Persisted last-selected frame id, so a reload restores a custom upload. */
const SELECTED_KEY = 'vto-selected-frame'

function recordToFrame(rec: CustomFrameRecord): Frame {
  return {
    id: rec.id,
    name: rec.name,
    modelUrl: URL.createObjectURL(rec.blob),
    // Custom frames have no static thumbnail asset; FrameThumbnail renders a
    // live ModelPreview off `modelUrl`, so this is never fetched.
    thumbUrl: '',
    attribution: { creator: 'Your upload', license: '', sourceUrl: '' },
    fit: rec.fit,
    custom: true,
  }
}

/**
 * Catalog selection store (Story 06). Holds which frame — and which lens tint —
 * is on the face. Custom uploads (IndexedDB) are appended to the static catalog
 * and behave like any other frame.
 *
 * Story 07 reads `selectedFrameId` for photo metadata / filenames — it is the
 * single source of truth for "what is the user wearing right now". The tint is a
 * runtime material override (GlassesSwap), so changing it never reloads the GLB.
 */
export const useCatalogStore = create<CatalogState>((set, get) => {
  const frameById = (id: string): Frame | undefined =>
    FRAMES.find((f) => f.id === id) ??
    get().customFrames.find((f) => f.id === id)

  // Restore a persisted BUILT-IN selection synchronously (custom uploads are
  // restored by loadCustomFrames once IndexedDB has been read).
  let savedInit: string | null = null
  try {
    savedInit = localStorage.getItem(SELECTED_KEY)
  } catch {
    /* ignore */
  }
  const initial =
    FRAMES.find((f) => f.id === savedInit) ??
    FRAMES.find((f) => f.id === DEFAULT_FRAME_ID)

  return {
    selectedFrameId: initial?.id ?? DEFAULT_FRAME_ID,
    selected: initial,
    setSelected: (id) => {
      const frame = frameById(id)
      if (!frame) return
      try {
        localStorage.setItem(SELECTED_KEY, id)
      } catch {
        /* private mode etc. — selection just won't persist */
      }
      set({ selectedFrameId: id, selected: frame })
    },

    customFrames: [],
    loadCustomFrames: async () => {
      let records: CustomFrameRecord[]
      try {
        records = await listCustomFrames()
      } catch {
        return // IndexedDB unavailable (private mode) — uploads just won't persist
      }
      const customFrames = records.map(recordToFrame)
      set({ customFrames })
      // Restore a persisted custom selection now that the frame exists.
      let savedId: string | null = null
      try {
        savedId = localStorage.getItem(SELECTED_KEY)
      } catch {
        /* ignore */
      }
      if (savedId && savedId !== get().selectedFrameId) {
        const frame = customFrames.find((f) => f.id === savedId)
        if (frame) set({ selectedFrameId: frame.id, selected: frame })
      }
    },
    addCustomFrame: (rec) => {
      const frame = recordToFrame(rec)
      set({ customFrames: [...get().customFrames, frame] })
      get().setSelected(frame.id)
    },
    removeCustomFrame: (id) => {
      const frame = get().customFrames.find((f) => f.id === id)
      if (!frame) return
      URL.revokeObjectURL(frame.modelUrl)
      set({ customFrames: get().customFrames.filter((f) => f.id !== id) })
      // If the deleted frame was on the face, fall back to the default.
      if (get().selectedFrameId === id) get().setSelected(DEFAULT_FRAME_ID)
      void deleteCustomFrame(id).catch(() => {
        /* already gone / unavailable — the in-memory removal stands */
      })
    },

    selectedTintId: DEFAULT_TINT_ID,
    selectedTint: tintById(DEFAULT_TINT_ID),
    setSelectedTint: (id) => {
      const tint = tintById(id)
      if (!tint) return
      set({ selectedTintId: id, selectedTint: tint })
    },
  }
})
