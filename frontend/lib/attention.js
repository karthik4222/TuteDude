// Attention heuristics
// Exposes: computeAttention(faces) and setAttentionConfig to tweak thresholds.

export let ATTENTION_CONFIG = {
  MAX_YAW_DEG: 20,         // tighten yaw (horizontal head turn) threshold
  MAX_PITCH_DEG: 15,       // tighten pitch (vertical tilt) threshold
  MIN_BOX_AREA_RATIO: 0.02,// ignore very tiny distant faces
  MAX_CENTER_OFFSET: 0.18, // how far (in normalized units) nose can drift from screen center before we consider user looking away (approx eye direction / framing)
};

export function setAttentionConfig(overrides = {}) {
  ATTENTION_CONFIG = { ...ATTENTION_CONFIG, ...overrides };
}

function computeBBox(landmarks) {
  let minX=1,minY=1,maxX=0,maxY=0;
  for (const p of landmarks) { if (p.x<minX) minX=p.x; if (p.y<minY) minY=p.y; if (p.x>maxX) maxX=p.x; if (p.y>maxY) maxY=p.y; }
  return { minX, minY, maxX, maxY, area: Math.max(0,maxX-minX)*Math.max(0,maxY-minY) };
}

function estimateYawPitch(landmarks) {
  const L=i=>landmarks[i];
  const eyeL=L(33), eyeR=L(263), nose=L(1), chin=L(152), forehead=L(10);
  if (!eyeL||!eyeR||!nose||!chin||!forehead) return { yawDeg:0, pitchDeg:0, valid:false };
  const eyeMidX=(eyeL.x+eyeR.x)/2;
  const yaw=(nose.x-eyeMidX)*180;
  const midY=(forehead.y+chin.y)/2;
  const pitch=(nose.y-midY)*180;
  return { yawDeg: yaw, pitchDeg: pitch, valid:true };
}

export function computeAttention(faceLandmarksArray) {
  if (!faceLandmarksArray || !faceLandmarksArray.length) return { attentive:false, faces:0 };
  // choose largest face (most likely candidate)
  let bestIdx=0,bestArea=-1;
  faceLandmarksArray.forEach((lm,i)=>{ const b=computeBBox(lm); if (b.area>bestArea){ bestArea=b.area; bestIdx=i; }});
  const landmarks = faceLandmarksArray[bestIdx];
  const { yawDeg, pitchDeg, valid } = estimateYawPitch(landmarks);
  const bbox = computeBBox(landmarks);
  // Approximate "center offset" using nose x from screen center (0.5)
  const nose = landmarks[1];
  const centerOffset = nose ? Math.abs(nose.x - 0.5) : 0;
  const { MAX_YAW_DEG, MAX_PITCH_DEG, MIN_BOX_AREA_RATIO, MAX_CENTER_OFFSET } = ATTENTION_CONFIG;
  const attentive = valid &&
    Math.abs(yawDeg) <= MAX_YAW_DEG &&
    Math.abs(pitchDeg) <= MAX_PITCH_DEG &&
    bbox.area >= MIN_BOX_AREA_RATIO &&
    centerOffset <= MAX_CENTER_OFFSET;
  return { attentive, yawDeg, pitchDeg, bboxArea: bbox.area, centerOffset, faces: faceLandmarksArray.length };
}
