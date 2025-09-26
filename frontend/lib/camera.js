// Camera helper
export async function setupCamera(videoEl, constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }) {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  await new Promise(res => videoEl.onloadedmetadata = res);
  await videoEl.play();
  return stream;
}

export function stopCamera(videoEl) {
  const stream = videoEl.srcObject;
  if (stream) for (const t of stream.getTracks()) t.stop();
  videoEl.srcObject = null;
}
