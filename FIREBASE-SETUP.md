# One-time Firebase setup — site owner

Visitors do not configure Firebase. The website connects automatically to the project specified in `js/firebase-config.js`.

## 1. Enable accounts and Firestore

In [Firebase Console](https://console.firebase.google.com/), select your project and register a **Web app**.

- **Authentication → Sign-in method:** enable **Email/Password**, and optionally **Google**.
- **Authentication → Settings → Authorized domains:** add your site hostname, such as `azmath25.github.io`, without the repository path. Add `localhost` only if needed.
- **Firestore Database:** create a Native mode database with ID **(default)**.

This version uses Authentication and Firestore. It does not use Cloud Storage, Storage rules, or bucket CORS.

## 2. Set the connection once

Copy the public web-app configuration from Firebase Project settings into `js/firebase-config.js`:

```js
export const firebaseConfig = {
  apiKey: "YOUR_PUBLIC_WEB_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  appId: "YOUR_WEB_APP_ID",
};
```

Use the actual Console values. The full standard configuration object is also accepted; optional fields such as `messagingSenderId` and `storageBucket` can remain, but a bucket is not used. Never include a service-account private key or Admin SDK credential.

Commit the file with the updated website. GitHub Pages stays on **Deploy from a branch → main → /(root)**. No build or custom workflow is needed. The old `settings.html` address simply redirects to the quiz list; there are no visitor-facing connection controls.

## 3. Publish one rule set

Open **Firestore Database → Rules**, paste the entire contents of `firebase/firestore.rules`, and press **Publish**. These rules protect upload permissions, private drafts, and account results.

Optional CLI deployment, from this project folder:

```sh
firebase deploy --only firestore --project YOUR_PROJECT_ID
```

`firebase.json` also includes an optional index exemption for the large quiz JSON text. Using Console rules without that exemption still works; the app does not query the JSON field.

## 4. Give an account upload access

1. Register or sign in on the website as a normal user. Verify the email.
2. Open **Account → Account ID**, or find the user's UID in Firebase Authentication.
3. In Firestore Console, create collection **roles**, document ID equal to that UID. Add one **string** field: `role` with value `teacher`.
4. Refresh the account page. **Upload quiz** now appears.

You can grant this to your own normal account or to another user's account. Without the document, that account remains a student. Delete its role document to revoke uploads; server writes are denied immediately and the refreshed interface hides Upload. The site cannot grant itself permission. `admin` is also accepted, but still manages only its own quizzes in this app.

## Check it

An ordinary account should not see Upload, and a direct visit to `upload.html` should show an access message. An approved, verified account can upload a private draft, publish/unpublish it, edit it, and remove it. A signed-out browser can open published quizzes but cannot open private drafts. Account results are private to their owner.

Online quiz bundles are limited to **900 KB including images**, below Firestore's 1 MiB document limit. Local files and exports retain the 20 MB limit. Quiz content and its catalog metadata commit together. Lists fetch up to 200 quizzes; recent account results show 30.

Data paths: `roles/{uid}`, `quizzes/{id}`, `quizzes/{id}/content/main`, and `users/{uid}/attempts/{attemptId}`. Content is stored as serialized JSON so it can be exported as one portable quiz file. Private drafts stay private through their parent quiz's visibility rule.

Scores are calculated in the browser for practice. Answer keys are in the quiz content, and account results are self-reported. Secure exams would need trusted server-side grading.

No live project is connected until your real configuration is supplied. Official references: [Web setup](https://firebase.google.com/docs/web/setup), [Authentication](https://firebase.google.com/docs/auth/web/password-auth), [Firestore limits](https://firebase.google.com/docs/firestore/quotas), [atomic-write rules](https://firebase.google.com/docs/firestore/security/rules-conditions).
