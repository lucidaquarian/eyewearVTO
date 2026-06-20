import { Matrix4, Quaternion, Vector3 } from 'three'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { DEFAULTS, OneEuroFilter, OneEuroVector } from '@/vto/lib/oneEuro'
import type { GlassesFit } from '@/vto/lib/glbAnalyzer'

/**
 * faceMath — turn MediaPipe's facial transformation matrix + landmarks into a
 * stable Three.js head-pose matrix for the glasses anchor.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE SYSTEM (verified against MediaPipe source + canonical model)
 * ---------------------------------------------------------------------------
 * MediaPipe's `facialTransformationMatrixes[0].data` is a 16-float, COLUMN-MAJOR
 * 4x4 matrix in a RIGHT-HANDED metric space whose axes match Three.js exactly:
 * +X = viewer's right, +Y = up, −Z = toward the camera. Units are CENTIMETERS
 * (the canonical face model is ~15.5 cm wide; a face ~60 cm away has tz ≈ −60).
 * The camera sits at the origin looking down −Z. Therefore:
 *   - `Matrix4.fromArray(data)` consumes it directly — NO transpose, NO axis
 *     remap (column-major in, column-major out).
 *   - The render scene works in CENTIMETERS, with a PerspectiveCamera at the
 *     origin, vertical fov = 63° (the constant baked into the FaceLandmarker
 *     graph), near = 1, far = 10000. See SceneCanvas.
 *
 * MIRROR / FLIP (HUMAN-TOGGLE DURING WEBCAM TESTING)
 *   The selfie mirror is NOT baked into this matrix any more. Premultiplying a
 *   negative-determinant scale here corrupts FaceMatrixSmoother.decompose()
 *   (the reflection folds into the quaternion/scale and the one-Euro filter
 *   scrambles it). Instead the mirror is a scene-level <group> scale applied
 *   OUTSIDE the smoother (SceneCanvas reads MIRROR_X / FLIP_Y below).
 *
 *   MIRROR_X — selfie mirror. The video is CSS-mirrored, so the scene is
 *              mirrored to match. Flip if the user's right eye does not line up
 *              with the right side of the screen.
 *   FLIP_Y   — set true only if the model renders upside down. Default false.
 * ---------------------------------------------------------------------------
 */

/** Selfie mirror, applied at the scene level (SceneCanvas). Flip if L/R wrong. */
export const MIRROR_X = true

/** Set true if the model renders upside down during webcam testing. */
export const FLIP_Y = false

/** MediaPipe nose-bridge landmark used to refine the anchor origin. */
export const NOSE_BRIDGE_IDX = 168
/** Left temple landmark (face-fit width). */
export const LEFT_TEMPLE_IDX = 234
/** Right temple landmark (face-fit width). */
export const RIGHT_TEMPLE_IDX = 454
/** Nose-tip landmark (forward-most point) — used for the head-depth proxy. */
export const NOSE_TIP_IDX = 1

/**
 * GLASSES REGISTRATION INTO THE CANONICAL FACE FRAME
 * --------------------------------------------------
 * The pose matrix maps the MediaPipe canonical face model into the live face.
 * Its origin is the canonical model origin (deep in the head, ~nose level), NOT
 * the nose bridge. To seat glasses correctly we register the GLB into canonical
 * space: a point authored at canonical coordinate P appears on the live face at
 * matrix · P. So we place the glasses' bridge-saddle at the canonical nose-bridge
 * landmark, scale the metre-authored GLB into centimetres, and offset the GLB's
 * own origin onto its bridge-saddle.
 *
 * All canonical coordinates are in CENTIMETRES, taken from
 * mediapipe/modules/face_geometry/data/canonical_face_model.obj.
 */

/** Canonical nose-bridge (landmark 168) — where the glasses' bridge rests (cm). */
export const NOSE_BRIDGE_ANCHOR_CM: readonly [number, number, number] = [
  0, 3.271, 5.236,
]

/**
 * GLB → scene scale. The GLB is authored in METRES (front frame ≈ 0.14984 m);
 * the scene is in CENTIMETRES, so ×100 would render it at its true ~15 cm width
 * (≈ the canonical temple span ~15.3 cm). Dialed down ~20% to 81: the shipped
 * sunglasses still read a touch large on real faces and sat slightly proud of
 * the head — smaller frames tuck the temples in and read as actually "worn".
 * Nudged up 4% (81 → 84.24) so the frames fill the face a touch more.
 * One uniform knob: raise/lower if frames read too wide/narrow on real faces.
 */
export const MODEL_TO_CM = 84.24

/**
 * Per-model seat offset (in the GLB's own METRE units) that moves the model's
 * bridge-saddle contact point to its local origin, so NOSE_BRIDGE_ANCHOR_CM then
 * places that contact on the nose. Derived from the sunglasses GLB geometry
 * (bridge-saddle at local [0, 0.03078, −0.00206] m).
 */
export const MODEL_SEAT_OFFSET_M: readonly [number, number, number] = [
  0, -0.03078, 0.00206,
]

/**
 * Build a Three.js head-pose Matrix4 from MediaPipe's column-major 16-float
 * matrix. The data is already column-major and in the same right-handed, +Y-up,
 * −Z-forward convention Three.js uses, so `fromArray` consumes it directly — no
 * transpose, no axis remap, no mirror (the mirror is applied at the scene level).
 * Units are centimetres. Returns a NEW matrix.
 */
export function matrixFromMediaPipe(data: number[] | Float32Array): Matrix4 {
  return new Matrix4().fromArray(Array.from(data))
}

/**
 * Transform a normalized MediaPipe landmark into the head-pose's local space is
 * not directly possible (landmarks are in image-normalized space, the matrix is
 * metric head space). Instead we use landmarks only to (a) measure face width
 * for scale and (b) compute the bridge offset direction in screen space. For
 * the anchor we keep the matrix translation but bias it toward the bridge.
 *
 * Returns the normalized landmark as a Vector3 (x,y in 0..1 image space, z the
 * MediaPipe-normalized depth), or null when out of range.
 */
export function landmarkToVec3(
  landmarks: NormalizedLandmark[] | null,
  index: number,
): Vector3 | null {
  const l = landmarks?.[index]
  if (!l) return null
  return new Vector3(l.x, l.y, l.z)
}

/**
 * Measured horizontal face width in normalized image units (temple to temple).
 * Used to derive a fit-to-face scale. Returns null if landmarks unavailable.
 *
 * We use the full 3D distance between the temple landmarks (not just dx) so a
 * yawed head still reports a sensible width.
 */
export function faceWidthNorm(
  landmarks: NormalizedLandmark[] | null,
): number | null {
  const left = landmarkToVec3(landmarks, LEFT_TEMPLE_IDX)
  const right = landmarkToVec3(landmarks, RIGHT_TEMPLE_IDX)
  if (!left || !right) return null
  const w = left.distanceTo(right)
  return w > 1e-5 ? w : null
}

/**
 * ADAPTIVE TEMPLE-ARM LENGTH (per person)
 * ---------------------------------------
 * The glasses GLB carries a full-length arm (a short `Temple*` hinge stub plus a
 * long `Earhook*` rear arm + ear curl). MediaPipe's metric pose already grows the
 * whole model with head SIZE (its uniform Procrustes scale), but it fits ONE fixed
 * canonical face PROPORTION to everyone, so it can't move the ear forward/back for
 * a deeper- or shallower-set head. We close that gap by scaling the arm length
 * along its own axis (Z, about the hinge) by a per-person factor.
 *
 * The factor is a SCALE-INVARIANT depth/width ratio of the live landmarks measured
 * against the same ratio on the canonical model — so it isolates face *proportion*
 * (what the matrix misses) from *size/distance* (which the matrix already handles).
 * It is clamped tightly around the as-authored length (1.0): the earhook already
 * reaches ~the ear at 1.0, so this only nudges, and a bad landmark frame can't send
 * the arm through the skull. Smooth the returned scalar (one-Euro) before applying.
 */

/** Hinge (frame/temple junction) Z in the GLB's METRE space — the arm-scale pivot. */
export const ARM_HINGE_Z_M = -0.012

/**
 * Soft ear taper band, in the GLB's model-root METRE Z (the arm runs along −Z).
 * The near temple arm is fully opaque ahead of START and fully faded by END, so it
 * ends softly around the ear-front (canonical temple 234/454 ≈ model Z −0.0873,
 * which sits inside this band) and the over-ear curl behind it never renders. Baked
 * per-vertex into the earhook geometry (GlassesSwap); the per-person arm-length
 * pivot scale then nudges the band onto each wearer's actual ear. Tunable.
 */
export const EAR_TAPER_START_Z = -0.075
export const EAR_TAPER_END_Z = -0.1

/**
 * Soft band length (model-root METRES) of the temple reveal's leading edge. FaceAnchor
 * slides a reveal frontier along each arm as the head turns; vertices within this
 * distance behind the frontier fade in/out, so the arm grows (or recedes) with a soft
 * edge instead of popping. Also sets the per-side frontier-start Z (just ahead of the
 * frontmost arm vertex) that the far arm recedes to — i.e. nothing shown. Larger =
 * softer/longer leading edge. Tunable.
 */
export const REVEAL_SOFT_M = 0.018

/**
 * Reveal-frontier Z (model-root METRES) for the HEAD-ON "front section": how far back
 * along each temple is shown when the wearer faces the camera, like real glasses seen
 * from the front. From here FaceAnchor grows the near arm toward the ear and recedes
 * the far arm toward the arm front as the head turns. Sits between the arm front
 * (≈ −0.012) and the ear (EAR_TAPER_*); larger (toward 0) shows a shorter front stub,
 * lower (toward the ear) shows more temple head-on (but risks poking past the head when
 * not yet turned). Tunable.
 */
export const TEMPLE_FRONT_SECTION_Z = -0.03

/** Clamp the adaptive arm-length scale around the as-authored length (1.0). */
export const ARM_SCALE_MIN = 0.85
export const ARM_SCALE_MAX = 1.25

/**
 * The per-model fit parameters above (seat offset, hinge, taper band, front
 * section) bundled as one record. The shipped catalog GLBs are authored to
 * these exact conventions so they use DEFAULT_FIT verbatim; USER-UPLOADED
 * models carry their own GlassesFit, derived once by glbAnalyzer at upload
 * time (and persisted with the upload), which normalises arbitrary
 * units/orientation into the same conventions.
 */
export const DEFAULT_FIT: GlassesFit = {
  unitScale: 1,
  preRotation: [0, 0, 0],
  seatOffsetM: MODEL_SEAT_OFFSET_M,
  hingeZ: ARM_HINGE_Z_M,
  frontSectionZ: TEMPLE_FRONT_SECTION_Z,
  earTaperStartZ: EAR_TAPER_START_Z,
  earTaperEndZ: EAR_TAPER_END_Z,
}

/**
 * Canonical depth/width ratio = |noseTip(1) → temple-midpoint| / |temple234↔454|,
 * from canonical_face_model.obj (cm): noseTip1 (0,−1.127,7.476),
 * temple 234/454 (±7.664,0.673,−2.436) → depth 10.074 / width 15.328 ≈ 0.657.
 * A live ratio above this means a deeper-set ear → longer arm (and vice-versa).
 */
const CANON_DEPTH_OVER_WIDTH = 0.657

/**
 * Per-person temple-arm length scale (multiplies the arm's Z about the hinge).
 * Returns null when the needed landmarks are unavailable (the caller then holds
 * its last value). Reuses {@link faceWidthNorm} (temple-to-temple) as the width.
 */
export function templeReachScale(
  landmarks: NormalizedLandmark[] | null,
): number | null {
  const width = faceWidthNorm(landmarks)
  const nose = landmarkToVec3(landmarks, NOSE_TIP_IDX)
  const left = landmarkToVec3(landmarks, LEFT_TEMPLE_IDX)
  const right = landmarkToVec3(landmarks, RIGHT_TEMPLE_IDX)
  if (!width || !nose || !left || !right) return null
  // temple-midpoint (left is a fresh local Vector3, safe to mutate)
  const templeMid = left.add(right).multiplyScalar(0.5)
  const ratio = nose.distanceTo(templeMid) / width / CANON_DEPTH_OVER_WIDTH
  return Math.min(ARM_SCALE_MAX, Math.max(ARM_SCALE_MIN, ratio))
}

/**
 * Forward-prediction (lead) applied to the smoothed pose to cancel the pipeline
 * latency that makes the glasses trail the face. Even on the fast GPU path the
 * displayed pose lags reality by ~1 detection frame plus the one-Euro group
 * delay, so the glasses sit a beat behind during head motion ("not quite
 * glued"). We extrapolate the smoothed pose forward by this many seconds along
 * its (already denoised) one-Euro velocity. Kept small so a quick STOP can't
 * overshoot the face; set to 0 to disable. ~0.02s ≈ a bit over half a 30fps
 * detection frame. Tune live against the webcam.
 */
const PREDICT_SECONDS = 0.02
/** Clamp on the predicted position lead per axis (cm) so a velocity spike on a
 *  noisy frame can't fling the glasses off the face. */
const POS_PREDICT_CLAMP_CM = 2
/** Clamp on each predicted quaternion-channel lead, before renormalisation. */
const ROT_PREDICT_CLAMP = 0.08

/** Clamp `v` to [-limit, +limit]. */
function clampAbs(v: number, limit: number): number {
  return v > limit ? limit : v < -limit ? -limit : v
}

/**
 * A smoother that one-Euro-filters a Matrix4's decomposed channels
 * (position xyz, quaternion xyzw, scale xyz) at a head-pose rate, then
 * recomposes. Filtering the decomposed channels — rather than the 16 raw
 * matrix entries — keeps rotations valid (we renormalize the quaternion) and
 * avoids shearing artifacts.
 *
 * After filtering it forward-predicts position + rotation by PREDICT_SECONDS
 * along the smoothed one-Euro velocity to cancel the ~1-frame pipeline latency
 * (see PREDICT_SECONDS above), so the glasses keep up with head motion instead
 * of trailing it. Scale is never predicted (leading it pulses the frame size).
 *
 * Both position and rotation use a raised `minCutoff` (2.0) and `beta` so the
 * glasses stay locked to the face instead of trailing (the "laggy / not stuck"
 * feel of Bug #2). The higher minCutoff lifts the baseline responsiveness — less
 * lag even at low/variable detection rates (e.g. when the device is loaded) — at
 * the cost of slightly more jitter at rest; `beta` then opens the filter up
 * further in proportion to speed so quick turns/nods snap rather than drag. Fed a
 * frame-accurate (video media-time) timestamp so dt/velocity are correct during
 * motion. Scale is filtered gently. Starting points; tune live against the webcam.
 */
export class FaceMatrixSmoother {
  private readonly posFilter = new OneEuroVector(3, {
    ...DEFAULTS,
    minCutoff: 2.0,
    beta: 0.4,
  })
  // Quaternion as 4 channels; renormalized after filtering.
  private readonly rotFilter = new OneEuroVector(4, {
    ...DEFAULTS,
    minCutoff: 2.0,
    beta: 0.6,
  })
  private readonly scaleFilter = new OneEuroVector(3, {
    ...DEFAULTS,
    minCutoff: 0.6,
    beta: 0.004,
  })

  private readonly pos = new Vector3()
  private readonly quat = new Quaternion()
  private readonly scale = new Vector3()
  private readonly out = new Matrix4()

  private readonly pBuf = [0, 0, 0]
  private readonly qBuf = [0, 0, 0, 0]
  private readonly sBuf = [0, 0, 0]
  private readonly pOut = [0, 0, 0]
  private readonly qOut = [0, 0, 0, 0]
  private readonly sOut = [0, 0, 0]

  /** Tracks last quaternion to keep sign continuity across frames. */
  private readonly prevQuat = new Quaternion()
  private hasPrev = false

  /**
   * Filter `m` and return an internally-owned, reused Matrix4. Do NOT retain
   * the returned reference across frames — copy it (the FaceAnchor does).
   */
  filter(m: Matrix4, timestampMs: number): Matrix4 {
    m.decompose(this.pos, this.quat, this.scale)

    // Keep the quaternion on the same hemisphere as last frame so the
    // per-channel filter doesn't see a sign flip (q and -q are the same
    // rotation but would jolt the linear filter).
    if (this.hasPrev && this.quat.dot(this.prevQuat) < 0) {
      this.quat.set(-this.quat.x, -this.quat.y, -this.quat.z, -this.quat.w)
    }

    this.pBuf[0] = this.pos.x
    this.pBuf[1] = this.pos.y
    this.pBuf[2] = this.pos.z
    this.qBuf[0] = this.quat.x
    this.qBuf[1] = this.quat.y
    this.qBuf[2] = this.quat.z
    this.qBuf[3] = this.quat.w
    this.sBuf[0] = this.scale.x
    this.sBuf[1] = this.scale.y
    this.sBuf[2] = this.scale.z

    this.posFilter.filter(this.pBuf, timestampMs, this.pOut)
    this.rotFilter.filter(this.qBuf, timestampMs, this.qOut)
    this.scaleFilter.filter(this.sBuf, timestampMs, this.sOut)

    // Lead the smoothed pose by PREDICT_SECONDS along its one-Euro velocity to
    // cancel pipeline latency (the glasses otherwise trail the face on motion).
    // Velocity is the filter's already-denoised derivative; each lead is clamped
    // so a jittery frame can't overshoot. Scale is intentionally not predicted.
    if (PREDICT_SECONDS > 0) {
      for (let i = 0; i < 3; i++) {
        this.pOut[i]! += clampAbs(
          this.posFilter.velocity(i) * PREDICT_SECONDS,
          POS_PREDICT_CLAMP_CM,
        )
      }
      for (let i = 0; i < 4; i++) {
        this.qOut[i]! += clampAbs(
          this.rotFilter.velocity(i) * PREDICT_SECONDS,
          ROT_PREDICT_CLAMP,
        )
      }
    }

    this.pos.set(this.pOut[0]!, this.pOut[1]!, this.pOut[2]!)
    this.quat.set(this.qOut[0]!, this.qOut[1]!, this.qOut[2]!, this.qOut[3]!)
    this.quat.normalize() // filtering + prediction break unit length; restore it
    this.scale.set(this.sOut[0]!, this.sOut[1]!, this.sOut[2]!)

    this.prevQuat.copy(this.quat)
    this.hasPrev = true

    return this.out.compose(this.pos, this.quat, this.scale)
  }

  reset(): void {
    this.posFilter.reset()
    this.rotFilter.reset()
    this.scaleFilter.reset()
    this.hasPrev = false
  }
}

/** Exponential approach factor for frame-rate-independent lerps (fade etc.). */
export function smoothFactor(dtSeconds: number, tauSeconds: number): number {
  if (tauSeconds <= 0) return 1
  return 1 - Math.exp(-dtSeconds / tauSeconds)
}

/** A scalar one-Euro filter ready to use for ad-hoc smoothing (e.g. scale). */
export function makeScalarFilter(): OneEuroFilter {
  return new OneEuroFilter()
}
