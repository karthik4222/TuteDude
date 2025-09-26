// --- Proctoring face pipeline logic moved from main.js ---
import { computeAttention } from './attention.js';
import { computeBBox } from './utils.js';

export function runFaceDetectionPipeline({
  result, ctx, overlayEl, lastFaceBoxes, faceCountEl, attentionStatusEl, noFaceTimerEl, inattentiveTimerEl, inattentiveCountEl,
  multiFaceStreak, inMultipleFaces, logEvent, MIN_SECOND_FACE_AREA_RATIO, MULTI_FACE_CONFIRM_FRAMES, noFaceStart, inattentiveStart, hadNoFace, wasInattentive, inattentiveCount, INATTENTION_THRESHOLD_S, NO_FACE_THRESHOLD_S
}) {
  // Draw faces
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  if (!result || !result.faceLandmarks) return { multiFaceStreak, inMultipleFaces, noFaceStart, inattentiveStart, hadNoFace, wasInattentive, inattentiveCount };
  const faces = result.faceLandmarks;
  ctx.lineWidth = 2;
  lastFaceBoxes.length = 0;
  for (const landmarks of faces) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of landmarks) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const x = minX * overlayEl.width;
    const y = minY * overlayEl.height;
    const w = (maxX - minX) * overlayEl.width;
    const h = (maxY - minY) * overlayEl.height;
    lastFaceBoxes.push({ x, y, w, h });
    ctx.strokeStyle = '#22c55e';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(34,197,94,0.9)';
    const indices = [1, 33, 263, 61, 291, 152, 10];
    for (const i of indices) {
      const p = landmarks[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * overlayEl.width, p.y * overlayEl.height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Attention and event logic
  faceCountEl.textContent = String(faces.length);
  const att = computeAttention(faces);
  const attentive = att.attentive;
  attentionStatusEl.textContent = faces.length > 0 ?
    (attentive
      ? `Attentive (yaw ${att.yawDeg.toFixed(1)}°, pitch ${att.pitchDeg.toFixed(1)}°)`
      : `Not attentive (yaw ${att.yawDeg.toFixed(1)}°, pitch ${att.pitchDeg.toFixed(1)}°)`) + ` off-center ${(att.centerOffset||0).toFixed(2)}`
    : '-';

  // multiple faces with confirmation streak
  if (faces.length >= 2) {
    const areas = faces.map(f => computeBBox(f).area).sort((a,b)=>b-a);
    const secondArea = areas[1] || 0;
    if (secondArea >= MIN_SECOND_FACE_AREA_RATIO) {
      multiFaceStreak++;
      if (multiFaceStreak === MULTI_FACE_CONFIRM_FRAMES && !inMultipleFaces) {
        inMultipleFaces = true;
        logEvent('MULTIPLE_FACES', `${faces.length} faces detected`);
      }
    } else {
      multiFaceStreak = 0;
    }
  } else {
    multiFaceStreak = 0;
    if (inMultipleFaces) {
      inMultipleFaces = false;
      logEvent('INFO', 'Multiple faces cleared');
    }
  }

  // timers
  const hasFace = faces.length > 0;
  const now = Date.now();
  if (!hasFace) { if (!noFaceStart) noFaceStart = now; } else { noFaceStart = null; }
  if (hasFace && !attentive) { if (!inattentiveStart) inattentiveStart = now; } else { inattentiveStart = null; }

  const nf = noFaceStart ? (now - noFaceStart) / 1000 : 0;
  const ia = inattentiveStart ? (now - inattentiveStart) / 1000 : 0;
  noFaceTimerEl.textContent = nf.toFixed(1) + 's';
  inattentiveTimerEl.textContent = ia.toFixed(1) + 's';

  if (!hasFace && nf > NO_FACE_THRESHOLD_S && !hadNoFace) { hadNoFace = true; logEvent('NO_FACE', `No face for ${nf.toFixed(1)}s`); }
  if (!hasFace && nf > NO_FACE_THRESHOLD_S && !hadNoFace) { hadNoFace = true; logEvent('NO_FACE', `No face for ${nf.toFixed(1)}s`); }
  if (hasFace) hadNoFace = false;
  if (hasFace && !attentive && ia > INATTENTION_THRESHOLD_S && !wasInattentive) {
    wasInattentive = true;
    inattentiveCount += 1;
    inattentiveCountEl.textContent = String(inattentiveCount);
    logEvent('INATTENTION', `Not looking at screen for ${ia.toFixed(1)}s (count ${inattentiveCount})`);
  }
  if (hasFace) hadNoFace = false;
  if (hasFace && !attentive && ia > INATTENTION_THRESHOLD_S && !wasInattentive) { wasInattentive = true; logEvent('INATTENTION', `Not looking at screen for ${ia.toFixed(1)}s`); }
  if (!hasFace || attentive) wasInattentive = false;

  return { multiFaceStreak, inMultipleFaces, noFaceStart, inattentiveStart, hadNoFace, wasInattentive, inattentiveCount };
}
// Face detection wrapper (MediaPipe Face Landmarker)
// Exposes: loadFaceModel, detectFaces

let faceLandmarker;

export async function loadFaceModel() {
  if (faceLandmarker) return faceLandmarker;
  const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
  const { FaceLandmarker, FilesetResolver } = vision;
  const filesetResolver = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');

  const urls = [
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float32/1/face_landmarker.task'
  ];
  let loaded = false;
  for (const url of urls) {
    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: url },
        runningMode: 'VIDEO',
        numFaces: 3,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      loaded = true;
      break;
    } catch(e) {
      console.warn('Face model load failed', url, e);
    }
  }
  if (!loaded) throw new Error('All face model URLs failed');
  return faceLandmarker;
}

export function detectFaces(videoEl, ts) {
  if (!faceLandmarker) return null;
  return faceLandmarker.detectForVideo(videoEl, ts);
}
