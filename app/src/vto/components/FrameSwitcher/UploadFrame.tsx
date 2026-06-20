import { useRef, useState } from 'react'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useCatalogStore } from '@/vto/stores/catalogStore'
import { putCustomFrame, type CustomFrameRecord } from '@/vto/lib/customFrames'
import { analyzeGlassesScene, GlbAnalysisError } from '@/vto/lib/glbAnalyzer'

/** Upload size cap — generous for glasses models, small enough for IndexedDB. */
const MAX_BYTES = 25 * 1024 * 1024

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }

/**
 * "Upload your own" tile at the end of the frame switcher: pick (or drop) a
 * .glb, run the automatic fit analysis (glbAnalyzer — scale/orientation/seat
 * recovery with built-in validation re-scans), persist it to IndexedDB and put
 * it straight on the face. Rejected files (not a GLB, too heavy, not a glasses
 * shape) surface the analyzer's reason inline; nothing is saved.
 */
export function UploadFrame() {
  const addCustomFrame = useCatalogStore((s) => s.addCustomFrame)
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [dragOver, setDragOver] = useState(false)

  const process = async (file: File) => {
    setStatus({ kind: 'busy' })
    try {
      if (file.size > MAX_BYTES) {
        throw new Error(
          `File is ${(file.size / 1048576).toFixed(0)} MB — the limit is 25 MB.`,
        )
      }
      const bytes = await file.arrayBuffer()
      // GLB magic: ASCII 'glTF' little-endian in the first 4 bytes.
      if (bytes.byteLength < 12 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) {
        throw new Error('Not a .glb file (binary glTF).')
      }
      const gltf = await new GLTFLoader().parseAsync(bytes, '')
      const fit = analyzeGlassesScene(gltf.scene)
      const rec: CustomFrameRecord = {
        id: `custom-${Date.now()}`,
        name: file.name.replace(/\.glb$/i, '') || 'Custom frame',
        blob: new Blob([bytes], { type: 'model/gltf-binary' }),
        fit,
        createdAt: Date.now(),
      }
      try {
        await putCustomFrame(rec)
      } catch {
        /* IndexedDB unavailable (private mode) — still usable this session */
      }
      addCustomFrame(rec)
      setStatus({ kind: 'idle' })
    } catch (err) {
      const message =
        err instanceof GlbAnalysisError || err instanceof Error
          ? err.message
          : 'Could not read this file.'
      setStatus({ kind: 'error', message })
    }
  }

  const busy = status.kind === 'busy'

  return (
    <div className="frame-switcher__item flex shrink-0 flex-col items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // allow re-uploading the same file
          if (file) void process(file)
        }}
      />
      <button
        type="button"
        aria-label="Upload your own glasses (.glb)"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files?.[0]
          if (file && !busy) void process(file)
        }}
        className={[
          'flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg bg-surface',
          'border border-dashed transition-colors duration-150',
          dragOver ? 'border-ink' : 'border-border hover:border-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          busy ? 'cursor-wait opacity-70' : '',
        ].join(' ')}
      >
        {busy ? (
          <span
            aria-hidden
            className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-ink"
          />
        ) : (
          <span aria-hidden className="text-2xl leading-none text-muted">
            +
          </span>
        )}
        <span className="px-1 text-center text-[10px] leading-tight text-muted">
          {busy ? 'Fitting…' : 'Upload .glb'}
        </span>
      </button>
      {status.kind === 'error' && (
        <span
          role="alert"
          className="max-w-24 text-center text-[10px] leading-tight text-red-600"
        >
          {status.message}
        </span>
      )}
    </div>
  )
}
