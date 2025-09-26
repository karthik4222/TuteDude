# Proctoring System (Browser + Node.js + MongoDB)

A modular browser-based proctoring system with face, attention, object, and noise detection. All events are logged and uploaded to a Node.js backend with MongoDB for session-based reporting and sincerity scoring.

## Features
- **Face Detection**: Detects presence, absence, and multiple faces.
- **Attention Detection**: Detects if the user is not looking at the screen.
- **Object Detection**: Detects phones, books, and more using MediaPipe and ml5.js.
- **Noise Detection**: Detects background noise using the Web Audio API.
- **Event Logging**: All events are logged with timestamps and session IDs.
- **Backend API**: Node.js/Express backend with MongoDB for event storage and reporting.
- **Session Reports**: Detailed session reports with sincerity score, accessible from the frontend UI.

## Folder Structure
```
backend/
  db.js           # MongoDB connection utility (ESM)
  server.js       # Express backend API (ESM)
  package.json    # Backend dependencies and config
frontend/
  index.html      # Main UI
  main.js         # Frontend logic (modular)
  styles.css      # UI styles
  lib/            # Modular detection logic (objects, faces, noise, etc.)
```

## Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- MongoDB (local or Atlas)

### Backend Setup
1. Install dependencies:
   ```sh
   cd backend
   npm install
   ```
2. Set environment variables as needed (optional):
   - `MONGO_URL` (default: `mongodb://localhost:27017`)
   - `DB_NAME` (default: `tutedude_proctor`)
3. Start the backend:
   ```sh
   node server.js
   ```
   The backend will listen on port 4000 by default.

### Frontend Setup
1. Open `frontend/index.html` in a browser (use `localhost` or HTTPS for camera access).
2. Use the UI to start a session, log events, and fetch session reports.

## API Endpoints
- `POST /api/events` — Log an event (called by frontend)
- `GET /api/reports/:sessionId` — Get all events for a session
- `GET /api/reports/:sessionId/detailed` — Get detailed report and sincerity score for a session

## Customization
- Detection logic is modular (see `frontend/lib/`).
- Sincerity scoring can be adjusted in `backend/server.js`.

## Troubleshooting
- Ensure MongoDB is running and accessible.
- Check backend logs for event upload errors.
- Use browser console for frontend errors.

## License
MIT
