// Browser-only proctoring using MediaPipe Tasks Vision
// Features:
// - Not looking at screen > 5s (attention heuristic)
// - No face > 10s
// - Multiple faces
// - Object detection: phone, book (watch approximated with clock)
// - Event log with CSV export and report JSON

// Thresholds
const NO_FACE_THRESHOLD_S = 10;
const INATTENTION_THRESHOLD_S = 5;

// Object detection (YOLO via ml5.js)
const OBJ_CONF_THRESHOLD = 0.4;
const OBJ_EVERY_N_FRAMES = 3;
const OBJ_COOLDOWN_S = 3.0; // throttle per label
// MediaPipe ObjectDetector config
const MP_OBJ_CONF_THRESHOLD = 0.4;
const PHONE_CONF_THRESHOLD = 0.1; // even lower for debugging
const CONFIRM_FRAMES = 1; // log on first detection
// Phone specific gating (very permissive for debug)
const MIN_PHONE_FRAMES = 1;
const PHONE_MIN_AR = 0.1;
const PHONE_MAX_AR = 10.0;
const PHONE_MIN_AREA_RATIO = 0.0005;
const PHONE_MAX_AREA_RATIO = 0.9;
const PHONE_IOU_MIN = 0.0;
// Multiple faces gating
const MULTI_FACE_CONFIRM_FRAMES = 3;
const MIN_SECOND_FACE_AREA_RATIO = 0.015; // second face must be at least this fraction
// Clock/watch filtering (to avoid faces mis-labelled as clock)
const CLOCK_FACE_IOU_DISCARD = 0.3; // if clock box overlaps face >= this, drop it
const CLOCK_MAX_AREA_RATIO = 0.05; // very large "clock" likely a face
// Map labels to event types we care about
const TARGET_LABEL_TO_EVENT = {
  'cell phone': 'PHONE',
  'mobile phone': 'PHONE',
  'smartphone': 'PHONE',
  'phone': 'PHONE',
  'book': 'BOOK',
  'paper': 'PAPER', // synthetic heuristic label
  'clock': 'WATCH', // proxy for watch
};

// Deductions for integrity score
const DEDUCTIONS = {
  INATTENTION: 2,
  NO_FACE: 5,
  MULTIPLE_FACES: 10,
  PHONE: 30,
  BOOK: 15,
  WATCH: 10,
};
DEDUCTIONS.PAPER = 10;

// DOM
const videoEl = document.getElementById('webcam');
const overlayEl = document.getElementById('overlay');
const ctx = overlayEl.getContext('2d');
const faceCountEl = document.getElementById('faceCount');
const attentionStatusEl = document.getElementById('attentionStatus');
const noFaceTimerEl = document.getElementById('noFaceTimer');
const inattentiveTimerEl = document.getElementById('inattentiveTimer');
const inattentiveCountEl = document.getElementById('inattentiveCount');
const lastObjectsEl = document.getElementById('lastObjects');
const eventLogEl = document.getElementById('eventLog');

const candidateInput = document.getElementById('candidateInput');
const candidateNameEl = document.getElementById('candidateName');
const sessionStatusEl = document.getElementById('sessionStatus');
const elapsedEl = document.getElementById('elapsed');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadReportBtn = document.getElementById('downloadReportBtn');

// MediaPipe / detection models
let faceLandmarker;
// Legacy object detector variables (objDetector/mpObjectDetector) replaced by modular objects.js
let detStreak = {}; // eventType -> consecutive polls present

// Label aliases to improve mapping across models
const LABEL_ALIASES = {
  'cell phone': 'cell phone',
  'mobile phone': 'cell phone',
  'smartphone': 'cell phone',
  'phone': 'cell phone',
  'cellphone': 'cell phone',
  'telephone': 'cell phone',
  'iphone': 'cell phone',
  'android phone': 'cell phone',
  'mobile': 'cell phone',
  'smart phone': 'cell phone',
  'cellular phone': 'cell phone',
  'telephone handset': 'cell phone',
  'handphone': 'cell phone',
  'feature phone': 'cell phone',
};

function eventFromLabel(labelRaw) {
  // Normalize: trim, lowercase, collapse spaces
  let l = (labelRaw || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const canon = LABEL_ALIASES[l] || l;
  const event = TARGET_LABEL_TO_EVENT[canon] || TARGET_LABEL_TO_EVENT[l];
  if (!event) {
    // Debug: log unmapped labels
    if (l) console.log('[eventFromLabel] Unmapped label:', labelRaw, '->', l);
  }
  return event;
}
let running = false;
let rafId = null;

// Timers and state
let noFaceStart = null;
let inattentiveStart = null;
let wasInattentive = false;
let hadNoFace = false;
let inMultipleFaces = false;
let lastObjLog = {}; // eventType -> timestamp
let lastPhoneBox = null; // {x,y,w,h}
let phoneStableFrames = 0;
let objectModelsLoaded = false; // ensure state at top-level (previous accidental inner placement removed)
let objectDetFrameCounter = 0;
let multiFaceStreak = 0;
let lastFaceBoxes = []; // store face boxes each frame for overlap tests

// Events and session (event storage handled by lib/events.js)
let session = { id: null, candidateName: '', startTs: null, endTs: null };
let startTimeMs = 0;

import { logEvent as coreLogEvent, getEvents, clearEvents, exportCsv, createReporter } from './lib/events.js';
let inattentiveCount = 0;
import { setupCamera, stopCamera } from './lib/camera.js';
import { loadFaceModel, detectFaces, runFaceDetectionPipeline } from './lib/faces.js';
import { computeAttention, setAttentionConfig } from './lib/attention.js';
import { loadObjectModels, detectObjects, runObjectDetectionPipeline } from './lib/objects.js';
import { startNoiseDetection, stopNoiseDetection } from './lib/noise.js';
const buildReport = createReporter({
  INATTENTION: 2,
  NO_FACE: 5,
  MULTIPLE_FACES: 10,
  PHONE: 30,
  BOOK: 15,
  WATCH: 10,
});
// Debug toggle
const debugObjectsToggle = document.getElementById('debugObjectsToggle');

function nowIso() { return new Date().toISOString(); }

function logEvent(type, detail = '') {
  const e = coreLogEvent(type, detail);
  const li = document.createElement('li');
  let cls = '';
  let icon = '';
  if (type === 'INATTENTION') cls = 'attention';
  else if (type === 'NO_FACE') cls = 'no-face';
  else if (type === 'MULTIPLE_FACES') cls = 'multiple';
  else if (type === 'ERROR') cls = 'no-face';
  else if (type === 'PHONE') { cls = 'phone'; icon = '📱 '; }
  if (cls) li.classList.add(cls);
  li.innerHTML = `<span class="ts">${e.ts}</span><strong>${icon}${type}</strong>${detail ? ` — ${detail}` : ''}`;
  eventLogEl.prepend(li);
  // Upload event to backend with session ID
  if (session && session.id) {
    fetch('http://localhost:4000/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        type,
        detail,
        timestamp: e.ts
      })
    }).catch(err => console.warn('Failed to upload event:', err));
  }
}

function clearLog() {
  clearEvents();
  eventLogEl.innerHTML = '';
  logEvent('INFO', 'Log cleared');
}

function downloadCsv() {
  const csv = exportCsv();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `events_${new Date().toISOString().replace(/[:.]/g,'-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function computeReport() {
  const rep = buildReport(session);
  const durationSec = session.endTs && session.startTs ? Math.max(0, Math.round((new Date(session.endTs) - new Date(session.startTs)) / 1000)) : Math.max(0, Math.round((Date.now() - startTimeMs) / 1000));
  return { ...rep, interviewDurationSec: durationSec };
}

function downloadReport() {
  const rep = computeReport();
  const blob = new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report_${rep.sessionId || 'session'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function msToClock(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function tickElapsed() {
  if (!running) return;
  elapsedEl.textContent = msToClock(Date.now() - startTimeMs);
  requestAnimationFrame(tickElapsed);
}

async function loadModels() {
  // Load face model (idempotent)
  faceLandmarker = await loadFaceModel();
  // Load object models via modular loader
  try {
    await loadObjectModels();
    logEvent('INFO', 'Object models loaded (ml5 + optional MediaPipe)');
  } catch(e) {
    logEvent('ERROR', 'Object models failed: ' + e.message);
  }
}



// Temporal smoothing buffers for each event type (label -> recent scores)
const TEMP_WINDOW = 5; // frames
const tempBuffers = {}; // evType -> [{score, ts}]
function pushTemp(evType, score) {
  const arr = tempBuffers[evType] || (tempBuffers[evType] = []);
  arr.push({ score, t: performance.now() });
  if (arr.length > TEMP_WINDOW) arr.shift();
  // Return average score over window
  return arr.reduce((s,a)=>s+a.score,0)/arr.length;
}

async function runObjectDetectOnce() {
  // Call the pipeline in objects.js and update state
  const result = await runObjectDetectionPipeline({
    videoEl, overlayEl, ctx, lastFaceBoxes, lastPhoneBox, phoneStableFrames, detStreak, lastObjLog, logEvent, debugObjectsToggle,
    eventFromLabel, PHONE_CONF_THRESHOLD, OBJ_CONF_THRESHOLD, CLOCK_MAX_AREA_RATIO, CLOCK_FACE_IOU_DISCARD, PHONE_MIN_AREA_RATIO, PHONE_MAX_AREA_RATIO, PHONE_MIN_AR, PHONE_MAX_AR, PHONE_IOU_MIN, MIN_PHONE_FRAMES, CONFIRM_FRAMES, OBJ_COOLDOWN_S
  });
  // Update stateful vars
  lastPhoneBox = result.lastPhoneBox;
  phoneStableFrames = result.phoneStableFrames;
}

async function loop() {
  if (!running) return;
  overlayEl.width = videoEl.videoWidth;
  overlayEl.height = videoEl.videoHeight;
  const ts = performance.now();
  const faceRes = detectFaces(videoEl, ts);
  if (faceRes) {
    // Use the modular pipeline for face/attention logic
    const faceState = runFaceDetectionPipeline({
      result: faceRes,
      ctx,
      overlayEl,
      lastFaceBoxes,
      faceCountEl,
      attentionStatusEl,
      noFaceTimerEl,
      inattentiveTimerEl,
      inattentiveCountEl,
      multiFaceStreak,
      inMultipleFaces,
      logEvent,
      MIN_SECOND_FACE_AREA_RATIO,
      MULTI_FACE_CONFIRM_FRAMES,
      noFaceStart,
      inattentiveStart,
      hadNoFace,
      wasInattentive,
      inattentiveCount,
      INATTENTION_THRESHOLD_S,
      NO_FACE_THRESHOLD_S
    });
    // Update stateful vars
    multiFaceStreak = faceState.multiFaceStreak;
    inMultipleFaces = faceState.inMultipleFaces;
    noFaceStart = faceState.noFaceStart;
    inattentiveStart = faceState.inattentiveStart;
    hadNoFace = faceState.hadNoFace;
    wasInattentive = faceState.wasInattentive;
    inattentiveCount = faceState.inattentiveCount;
  }
  // Object detection every N frames (~throttle)
  loop._frame = (loop._frame || 0) + 1;
  if ((loop._frame % OBJ_EVERY_N_FRAMES) === 0) {
    runObjectDetectOnce();
  }
  rafId = requestAnimationFrame(loop);
}

async function startSession() {
  const candidateName = (candidateInput.value || '').trim();
  if (!candidateName) {
    alert('Enter candidate name first.');
    return;
  }
  startBtn.disabled = true; stopBtn.disabled = false;
  clearLogBtn.disabled = true; downloadCsvBtn.disabled = true; downloadReportBtn.disabled = true;
  sessionStatusEl.textContent = 'Starting...';
  candidateNameEl.textContent = candidateName;
  try {
    await setupCamera(videoEl);
    if (!faceLandmarker) {
      logEvent('INFO', 'Loading models…');
      await loadModels();
      logEvent('INFO', 'Models loaded');
    }
    running = true;
    session = { id: crypto.randomUUID(), candidateName, startTs: nowIso(), endTs: null };
    startTimeMs = Date.now();
    sessionStatusEl.textContent = 'Running';
    // Start noise detection and pass logEvent
    startNoiseDetection(logEvent);
    loop();
    tickElapsed();
  } catch (e) {
    console.error(e);
    logEvent('ERROR', String(e));
    sessionStatusEl.textContent = 'Error';
    startBtn.disabled = false; stopBtn.disabled = true;
  } finally {
    clearLogBtn.disabled = false; downloadCsvBtn.disabled = false; downloadReportBtn.disabled = false;
  }
}

function stopSession() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  stopCamera(videoEl);
  // Stop noise detection
  stopNoiseDetection();
  session.endTs = nowIso();
  // frontend-only mode: no remote buffer / backend stop
  sessionStatusEl.textContent = 'Stopped';
  startBtn.disabled = false; stopBtn.disabled = true;
}

startBtn.addEventListener('click', startSession);
stopBtn.addEventListener('click', stopSession);
clearLogBtn.addEventListener('click', clearLog);
downloadCsvBtn.addEventListener('click', downloadCsv);
downloadReportBtn.addEventListener('click', downloadReport);


// --- Session Report Fetch UI ---
const getReportBtn = document.getElementById('getReportBtn');
if (getReportBtn) {
  getReportBtn.onclick = async function() {
    const sessionId = document.getElementById('reportSessionId').value.trim();
    const resultEl = document.getElementById('reportResult');
    if (!sessionId) {
      resultEl.textContent = 'Please enter a session ID.';
      return;
    }
    resultEl.textContent = 'Loading...';
    try {
      const res = await fetch(`http://localhost:4000/api/reports/${sessionId}/detailed`);
      if (!res.ok) {
        resultEl.textContent = 'Not found or error: ' + (await res.text());
        return;
      }
      const data = await res.json();
      resultEl.textContent = JSON.stringify(data.summary, null, 2);
    } catch (e) {
      resultEl.textContent = 'Error: ' + e.message;
    }
  };
}

logEvent('INFO', 'Ready. Enter candidate name and click Start Session.');

// (Removed looksLikeFace filter; using raw detector output for faces)

import { boxIoU, computeBBox } from './lib/utils.js';
