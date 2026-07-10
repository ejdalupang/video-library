# Video Library

Personal library for saving Instagram and TikTok video links, organized by category, with inline playback (no leaving the page).

## Status

Currently running in **local-only demo mode** — entries are saved to this browser's storage only, and won't sync across devices. To enable syncing, follow the Firebase setup below.

## Enable cross-device sync (Firebase — free)

1. Go to https://console.firebase.google.com → **Add project** → give it any name (e.g. `video-library`) → you can skip Google Analytics.
2. Once created, click the **Web** icon (`</>`) to register a web app. Name it anything, skip Firebase Hosting.
3. Copy the `firebaseConfig` object it shows you and paste the values into `firebase-config.js` in this folder (replacing the `REPLACE_ME` placeholders).
4. In the left sidebar, go to **Build → Firestore Database → Create database**. Start in **production mode**, pick any region.
5. Go to the **Rules** tab of Firestore and replace the contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /videos/{videoId} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
   This allows read/write only to signed-in requests. The app signs in anonymously automatically — this isn't user-level security, just a basic gate against random internet bots hitting your data.
6. Go to **Build → Authentication → Get started → Sign-in method** and enable **Anonymous**.
7. Reload the app — the demo-mode banner should disappear once `firebase-config.js` has real values.

## Deploy via GitHub Pages

1. Create a new empty repo on github.com named `video-library` (no README/license, so it's truly empty).
2. Tell Claude the repo is ready — it'll push this code and enable Pages, same as the resto-explorer setup.
