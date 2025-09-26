// noise.js - Background noise/speech detection for proctoring
// Logs a NOISE event if loud/speaking voice is detected for >5s

let audioContext, analyser, micStream, dataArray, noiseActive = false, noiseStart = null, noiseTimer = null;
const NOISE_THRESHOLD = 0.025; // Lowered for more sensitivity
const NOISE_MIN_DURATION = 100; // ms (5 seconds)

export function startNoiseDetection(logEvent) {
  if (audioContext) return; // Already running
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    micStream = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    micStream.connect(analyser);
    dataArray = new Uint8Array(analyser.fftSize);
    noiseActive = false;
    noiseStart = null;
    noiseTimer = setInterval(() => checkNoiseLevel(logEvent), 200);
  }).catch(e => {
    console.warn('Microphone access denied or error:', e);
  });
}

export function stopNoiseDetection() {
  if (noiseTimer) clearInterval(noiseTimer);
  noiseTimer = null;
  if (audioContext) audioContext.close();
  audioContext = null;
  micStream = null;
  analyser = null;
  dataArray = null;
  noiseActive = false;
  noiseStart = null;
}

function checkNoiseLevel(logEvent) {
  if (!analyser || !dataArray) return;
  analyser.getByteTimeDomainData(dataArray);
  // Compute normalized RMS (root mean square) volume
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const v = (dataArray[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / dataArray.length);
  // Debug: log RMS value
  console.log('[NoiseDetection] RMS:', rms.toFixed(4));
  if (rms > NOISE_THRESHOLD) {
    if (!noiseActive) {
      noiseActive = true;
      noiseStart = Date.now();
    } else if (Date.now() - noiseStart > NOISE_MIN_DURATION) {
      logEvent('NOISE', 'Background speaking/noise detected');
      noiseActive = false; // Prevent repeated logs
      noiseStart = null;
    }
  } else {
    noiseActive = false;
    noiseStart = null;
  }
}
