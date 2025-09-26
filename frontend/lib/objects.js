import { boxIoU } from './utils.js';
// --- Proctoring pipeline logic moved from main.js ---
let tempBuffers = {}; // evType -> [{score, ts}]
const TEMP_WINDOW = 5;
export function pushTemp(evType, score) {
  const arr = tempBuffers[evType] || (tempBuffers[evType] = []);
  arr.push({ score, t: performance.now() });
  if (arr.length > TEMP_WINDOW) arr.shift();
  return arr.reduce((s,a)=>s+a.score,0)/arr.length;
}

export function derivePaperFromBook(d) {
  if (!d || !d.w || !d.h) return null;
  const ar = d.h / d.w;
  if (ar > 1.4 || ar < 0.7) {
    return { label: 'paper', score: d.score * 0.9, x:d.x, y:d.y, w:d.w, h:d.h, synthetic:true };
  }
  return null;
}

// The main detection pipeline, moved from main.js
export async function runObjectDetectionPipeline({
  videoEl, overlayEl, ctx, lastFaceBoxes, lastPhoneBox, phoneStableFrames, detStreak, lastObjLog, logEvent, debugObjectsToggle,
  eventFromLabel, PHONE_CONF_THRESHOLD, OBJ_CONF_THRESHOLD, CLOCK_MAX_AREA_RATIO, CLOCK_FACE_IOU_DISCARD, PHONE_MIN_AREA_RATIO, PHONE_MAX_AREA_RATIO, PHONE_MIN_AR, PHONE_MAX_AR, PHONE_IOU_MIN, MIN_PHONE_FRAMES, CONFIRM_FRAMES, OBJ_COOLDOWN_S
}) {
  if (!videoEl.videoWidth) return { present: new Set(), lastPhoneBox, phoneStableFrames };
  const dets = await detectObjects(videoEl, overlayEl);
  const agg = {};
  for (const d of dets) {
    const k = d.label.toLowerCase();
    if (!agg[k] || d.score > agg[k].score) agg[k] = d;
  }
  if (agg['book']) {
    const paperCandidate = derivePaperFromBook(agg['book']);
    if (paperCandidate) {
      const k = 'paper';
      if (!agg[k] || paperCandidate.score > agg[k].score) agg[k] = paperCandidate;
    }
  }
  const nowSec = performance.now()/1000;
  const present = new Set();
  const labelsStr = [];
  for (const d of Object.values(agg)) {
    const evType = eventFromLabel(d.label);
    if (!evType) continue;
    const baseThr = evType === 'PHONE' ? PHONE_CONF_THRESHOLD : OBJ_CONF_THRESHOLD;
    if (d.score < baseThr * 0.6) continue;
    if (evType === 'WATCH') {
      if (d.w && d.h) {
        const areaRatio = (d.w*d.h)/(overlayEl.width*overlayEl.height);
        if (areaRatio > CLOCK_MAX_AREA_RATIO) continue;
        if (lastFaceBoxes.some(f => boxIoU(f,d) >= CLOCK_FACE_IOU_DISCARD)) continue;
      } else continue;
    }
    if (evType === 'PHONE') {
      if (!d.w || !d.h) continue;
      const ar = d.h / d.w;
      const areaRatio = (d.w*d.h)/(overlayEl.width*overlayEl.height);
      if (areaRatio < PHONE_MIN_AREA_RATIO || areaRatio > PHONE_MAX_AREA_RATIO || ar < PHONE_MIN_AR || ar > PHONE_MAX_AR) continue;
      if (lastPhoneBox) {
        const iou = boxIoU(lastPhoneBox, d);
        if (iou >= PHONE_IOU_MIN) phoneStableFrames++; else phoneStableFrames = 1;
      } else { phoneStableFrames = 1; }
      lastPhoneBox = { x:d.x,y:d.y,w:d.w,h:d.h };
      if (phoneStableFrames < MIN_PHONE_FRAMES) continue;
    }
    const avgScore = pushTemp(evType, d.score);
    const effThr = baseThr;
    if (avgScore < effThr) continue;
    present.add(evType);
    labelsStr.push(`${d.label} ${(d.score*100).toFixed(0)}%`);
    if (debugObjectsToggle.checked || evType === 'PHONE' || evType === 'BOOK' || evType === 'WATCH' || evType === 'PAPER') {
      if (d.x!=null && d.y!=null && d.w!=null && d.h!=null) {
        ctx.strokeStyle = evType==='PHONE'? '#f59e0b' : evType==='BOOK' ? '#6366f1' : evType==='PAPER'? '#0ea5e9' : '#f472b6';
        ctx.lineWidth = 2;
        ctx.strokeRect(d.x,d.y,d.w,d.h);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(d.x,d.y,d.w,20);
        ctx.fillStyle = '#fff';
        ctx.font = '13px sans-serif';
        ctx.fillText(`${d.label} ${(d.score*100).toFixed(0)}%`, d.x+4, d.y+14);
      }
    }
  }
  for (const evType of ['PHONE','BOOK','WATCH','PAPER']) {
    if (present.has(evType)) {
      detStreak[evType] = (detStreak[evType]||0)+1;
      if (detStreak[evType] >= CONFIRM_FRAMES) {
        const last = lastObjLog[evType]||0;
        if (nowSec - last >= OBJ_COOLDOWN_S) {
          lastObjLog[evType] = nowSec;
          // Debug: log to console before logging event
          console.log('[runObjectDetectionPipeline] Logging event:', evType, `${evType.toLowerCase()} detected`);
          logEvent(evType, `${evType.toLowerCase()} detected`);
        }
      }
    } else {
      detStreak[evType] = 0;
      if (evType==='PHONE') { phoneStableFrames=0; lastPhoneBox=null; }
    }
  }
  if (labelsStr.length) {
    if (typeof lastObjectsEl !== 'undefined' && lastObjectsEl) lastObjectsEl.textContent = labelsStr.join(', ');
  }
  return { present, lastPhoneBox, phoneStableFrames };
}
// Object detection ensemble (ml5 + optional MediaPipe EfficientDet)
// Exposes: loadObjectModels, detectObjects

let ml5Detector;
let mpDetector;

export async function loadObjectModels() {
  if (ml5Detector) return { ml5Detector, mpDetector };
  if (typeof window.ml5 === 'undefined') throw new Error('ml5 not loaded');
  try {
    ml5Detector = await new Promise((resolve, reject) => {
      try { const det = ml5.objectDetector('yolo', () => resolve(det)); } catch(e){ reject(e); }
    });
  } catch (e) {
    console.warn('YOLO load failed, fallback to coco-ssd', e);
    ml5Detector = await new Promise((resolve, reject) => {
      try { const det = ml5.objectDetector('cocossd', () => resolve(det)); } catch(e2){ reject(e2); }
    });
  }

  // Try MediaPipe EfficientDet (best-effort)
  try {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
    const { ObjectDetector, FilesetResolver } = vision;
    const filesetResolver = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    const urls = [
      'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
      'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite'
    ];
    for (const url of urls) {
      try {
        mpDetector = await ObjectDetector.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: url },
          scoreThreshold: 0.4,
          runningMode: 'VIDEO',
          maxResults: 10,
        });
        break;
      } catch(err) { console.warn('MP object model failed', url, err); }
    }
  } catch(e) { console.warn('MediaPipe object stack load failed', e); }

  return { ml5Detector, mpDetector };
}

function normMl5(preds) {
  return (preds||[]).map(p => ({
    label: p.label || p.className || p.class || '',
    score: p.confidence ?? p.score ?? 0,
    x: p.x ?? p.xmin ?? p.left,
    y: p.y ?? p.ymin ?? p.top,
    w: p.w ?? p.width ?? (p.xmax && p.xmin ? p.xmax - p.xmin : undefined),
    h: p.h ?? p.height ?? (p.ymax && p.ymin ? p.ymax - p.ymin : undefined),
    src: 'ml5'
  }));
}

function normMp(res, overlayW, overlayH) {
  if (!res) return [];
  const dets = res.detections || [];
  const out = [];
  for (const d of dets) {
    const cat = d.categories?.[0];
    if (!cat) continue;
    const bb = d.boundingBox;
    let x,y,w,h;
    if (bb) {
      const norm = bb.width <=1 && bb.height <=1;
      const sx = norm? overlayW:1; const sy = norm? overlayH:1;
      x = (bb.originX ?? bb.xMin ?? 0)*sx;
      y = (bb.originY ?? bb.yMin ?? 0)*sy;
      w = (bb.width ?? ((bb.xMax??0)-(bb.xMin??0)))*sx;
      h = (bb.height ?? ((bb.yMax??0)-(bb.yMin??0)))*sy;
    }
    out.push({ label: cat.categoryName, score: cat.score, x,y,w,h, src:'mp'});
  }
  return out;
}

export async function detectObjects(videoEl, overlayEl) {
  // Check detectors
  if (!ml5Detector) {
    console.warn('ml5Detector not initialized');
    return [];
  }
  // Optionally check mpDetector as well (not required for fallback)
  // if (!mpDetector) {
  //   console.warn('mpDetector not initialized');
  // }

  // Check video element readiness
  if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0 || videoEl.readyState < 2) {
    console.warn('Video element not ready or has invalid dimensions', {
      videoWidth: videoEl && videoEl.videoWidth,
      videoHeight: videoEl && videoEl.videoHeight,
      readyState: videoEl && videoEl.readyState
    });
    return [];
  }

  const ml5Preds = await new Promise(r => ml5Detector.detect(videoEl, (e,res)=> r(res||[])));
  const ml5Norm = normMl5(ml5Preds);
  let mpNorm = [];
  if (mpDetector) {
    const ts = performance.now();
    const mpRes = mpDetector.detectForVideo(videoEl, ts);
    mpNorm = normMp(mpRes, overlayEl.width, overlayEl.height);
  }
  // Debug: log all raw detections from both models
  if (ml5Norm.length || mpNorm.length) {
    console.log('[ObjectDetection] Raw ml5 detections:', ml5Norm);
    console.log('[ObjectDetection] Raw MediaPipe detections:', mpNorm);
  } else {
    console.log('[ObjectDetection] No detections from either model');
  }
  const agg = {};
  for (const d of [...ml5Norm, ...mpNorm]) {
    if (!d.label) continue;
    const k = d.label.toLowerCase();
    if (!agg[k] || d.score > agg[k].score) agg[k] = d;
  }
  return Object.values(agg);
}
