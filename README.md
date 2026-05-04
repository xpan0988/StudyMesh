# StudyMesh (PT1)

## Overview
StudyMesh is a browser-based study group collaboration workspace for INFO2222 Phase 3. It provides authenticated group collaboration through Supabase and combines core study coordination tools in one interface.

Main tools include group chat, a shared task board, alerts, resources, timetable availability, and meeting-time recommendation.

Security focus in this MVP includes email/password authentication via Supabase Auth, HTTPS/TLS transport protection, and encrypted chat payload support for E2EE-style flows.

## Features
- Email/password authentication via Supabase Auth
- Group creation and group joining by code
- Shared task board with owners, priorities, due dates, and completion status
- Group chat with encrypted message payload support
- Alerts with acknowledgement flow
- Resource upload/download through Supabase Storage
- Weekly availability selection and meeting time recommendation
- Polling-based synchronization across clients

## Security / Architecture Notes
- Supabase Auth handles user authentication.
- Passwords are not stored manually in frontend code or app tables.
- HTTPS/TLS protects data in transit.
- E2EE chat stores encrypted payloads rather than plain chat text where enabled.
- The Web Crypto API is used for browser-side cryptographic operations.
- Supabase stores application data and files (Postgres + Storage).
- This project is an academic MVP and not a fully hardened production key-management system.

## Tech Stack
- HTML, CSS, and vanilla JavaScript modules
- Supabase (Auth, Postgres, Storage)
- Web Crypto API

## Running Locally
1. Start a static server from the repository root:
   ```bash
   python3 -m http.server 8000
   ```
2. Open:
   ```
   http://localhost:8000
   ```

Notes:
- Do not open `index.html` with `file://`.
- `js/config.js` must contain valid Supabase project configuration.
- A correctly configured Supabase schema and policies are required.

## Deployment
Live demo: https://study-mesh.vercel.app/

StudyMesh is deployed as a static web app on Vercel. No build step is required.

## Repository Structure
- `index.html`
- `styles.css`
- `js/config.js`
- `js/state.js`
- `js/auth.js`
- `js/api.js`
- `js/chat.js`
- `js/e2ee.js`
- `js/tasks.js`
- `js/alerts.js`
- `js/resources.js`
- `js/timetable.js`
- `js/render.js`
- `js/app.js`

## Current Limitations
- Polling-based synchronization is not instant realtime.
- Browser-side key storage is acceptable for MVP/demo but not hardened production key management.
- Supabase schema and policies must be configured correctly.
- Some older encrypted messages may not decrypt if key format changed during development.
