/**
 * customFrames — IndexedDB persistence for USER-UPLOADED glasses GLBs.
 *
 * There is no backend (the catalog is static files), so uploads live in the
 * browser: the raw GLB bytes plus the GlassesFit derived once at upload time
 * (see glbAnalyzer). On app start the catalog store loads every record and
 * mints a session blob URL per model for `useGLTF`.
 *
 * Hand-rolled minimal wrapper (one object store, keyPath `id`) — not worth a
 * dependency.
 */
import type { GlassesFit } from '@/vto/lib/glbAnalyzer'

export interface CustomFrameRecord {
  /** Stable id (also the catalog frame id), e.g. `custom-1718000000000`. */
  id: string
  /** Display name (the upload's file name, sans extension). */
  name: string
  /** The raw .glb bytes. */
  blob: Blob
  /** Fit derived by glbAnalyzer at upload time (analysis never re-runs). */
  fit: GlassesFit
  createdAt: number
}

const DB_NAME = 'vto-custom-frames'
const DB_VERSION = 1
const STORE = 'frames'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

/** One transaction wrapping helper; closes the db when done. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'))
    })
  } finally {
    db.close()
  }
}

/** All stored uploads, oldest first. */
export async function listCustomFrames(): Promise<CustomFrameRecord[]> {
  const all = await withStore<CustomFrameRecord[]>('readonly', (s) =>
    s.getAll(),
  )
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function putCustomFrame(rec: CustomFrameRecord): Promise<void> {
  await withStore('readwrite', (s) => s.put(rec))
}

export async function deleteCustomFrame(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id))
}
