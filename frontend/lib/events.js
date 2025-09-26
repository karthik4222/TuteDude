// Event logging module
// Provides: logEvent, clearEvents, getEvents, exportCsv, createReporter

const _events = [];
let _unsent = [];
let _sessionInfo = null; // {id, candidateName }
let _flushIntervalId = null;
let _remoteEnabled = false; // off by default (frontend-only mode)

export function enableRemote() { _remoteEnabled = true; }
export function disableRemote() { _remoteEnabled = false; }

export function initRemoteBuffer(session) {
  if (!_remoteEnabled) return; // no-op when remote disabled
  _sessionInfo = session; // expect { id, candidateName }
  _unsent = [];
  if (_flushIntervalId) clearInterval(_flushIntervalId);
  // periodic flush every 10s
  _flushIntervalId = setInterval(flushRemote, 10000);
}

export function endRemoteBuffer() {
  if (!_remoteEnabled) { _sessionInfo = null; return; }
  flushRemote();
  if (_flushIntervalId) clearInterval(_flushIntervalId);
  _flushIntervalId = null;
  _sessionInfo = null;
}

async function flushRemote() {
  if (!_remoteEnabled || !_sessionInfo || _unsent.length === 0) return;
  const payload = { sessionId: _sessionInfo.id, candidateName: _sessionInfo.candidateName, events: _unsent.slice() };
  _unsent = [];
  try {
    await fetch('http://localhost:4000/api/events/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (e) {
    // put them back if failed
    _unsent.push(...payload.events);
  }
}

function nowIso() { return new Date().toISOString(); }

export function logEvent(type, detail = '') {
  const e = { ts: nowIso(), type, detail };
  _events.push(e);
  if (_remoteEnabled && _sessionInfo) {
    _unsent.push(e);
    if (type === 'INATTENTION' || type === 'NO_FACE') flushRemote();
  }
  return e;
}

export function getEvents() { return _events.slice(); }

export function clearEvents() { _events.length = 0; }

export function exportCsv() {
  const header = 'timestamp,type,detail\n';
  const rows = _events.map(e => `${e.ts},${e.type},"${(e.detail||'').replace(/"/g,'""')}"`).join('\n');
  return header + rows;
}

export function createReporter(deductions) {
  return function buildReport(session) {
    const counts = {};
    for (const e of _events) counts[e.type] = (counts[e.type] || 0) + 1;
    let penalty = 0;
    for (const [t,c] of Object.entries(counts)) penalty += (deductions[t]||0) * c;
    const integrityScore = Math.max(0, 100 - penalty);
    return {
      sessionId: session.id,
      candidateName: session.candidateName,
      startTs: session.startTs,
      endTs: session.endTs,
      eventCounts: counts,
      integrityScore,
    };
  };
}
