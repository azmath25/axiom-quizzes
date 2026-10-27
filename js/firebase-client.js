import { firebaseConfig } from "./firebase-config.js";
import { resolveFirebaseConfig, firebaseError } from "./firebase-core.js";

export const FIREBASE_SDK_VERSION = "13.1.0";
let current = {
  status: "unconfigured",
  user: null,
  role: "student",
  source: "none",
  error: "",
  roleError: "",
  roleLoading: false,
};
let initialization, services;
const listeners = new Set();
export const getSession = () => ({ ...current });
export function watchSession(listener) {
  listeners.add(listener);
  listener(getSession());
  return () => listeners.delete(listener);
}
function update(patch) {
  current = { ...current, ...patch };
  for (const listener of listeners) {
    try {
      listener(getSession());
    } catch (e) {
      console.error(e);
    }
  }
}
function userSummary(user) {
  return user
    ? {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        emailVerified: user.emailVerified,
      }
    : null;
}
export function connectionConfiguration() {
  return resolveFirebaseConfig(firebaseConfig);
}
export function initFirebase() {
  if (initialization) return initialization;
  initialization = (async () => {
    let resolved;
    try {
      resolved = connectionConfiguration();
    } catch (error) {
      update({ status: "error", error: firebaseError(error) });
      return null;
    }
    if (!resolved.config) {
      update({ status: "unconfigured", source: "none" });
      return null;
    }
    update({ status: "connecting", source: resolved.source, error: "" });
    try {
      const prefix = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
      const [appSDK, authSDK, firestoreSDK] = await Promise.all([
        import(prefix + "firebase-app.js"),
        import(prefix + "firebase-auth.js"),
        import(prefix + "firebase-firestore.js"),
      ]);
      const app = appSDK.getApps().length
        ? appSDK.getApp()
        : appSDK.initializeApp(resolved.config);
      const auth = authSDK.getAuth(app),
        db = firestoreSDK.getFirestore(app);
      services = { app, auth, db, authSDK, firestoreSDK };
      await authSDK.setPersistence(auth, authSDK.browserLocalPersistence);
      await new Promise((resolve, reject) => {
        let first = true;
        authSDK.onAuthStateChanged(
          auth,
          (user) => {
            update({
              status: "ready",
              user: userSummary(user),
              role: "student",
              roleLoading: Boolean(user),
              roleError: "",
              error: "",
            });
            if (first) {
              first = false;
              resolve();
            }
            if (user) refreshRole().catch(() => {});
          },
          reject,
        );
      });
      return services;
    } catch (error) {
      update({ status: "error", error: firebaseError(error) });
      return null;
    }
  })();
  return initialization;
}
export async function getFirebaseServices() {
  const result = await initFirebase();
  if (!result)
    throw new Error(
      current.error ||
        "Account features are not available yet. You can still use quizzes on this device.",
    );
  return result;
}
export async function refreshRole() {
  if (!services?.auth.currentUser) return;
  const uid = services.auth.currentUser.uid,
    f = services.firestoreSDK;
  try {
    const snapshot = await f.getDoc(f.doc(services.db, "roles", uid));
    if (services.auth.currentUser?.uid !== uid) return;
    const role = snapshot.exists() ? snapshot.data().role : "student";
    update({
      user: userSummary(services.auth.currentUser),
      role: ["teacher", "admin"].includes(role) ? role : "student",
      roleError: "",
      roleLoading: false,
    });
  } catch (error) {
    if (services.auth.currentUser?.uid === uid)
      update({
        role: "student",
        roleLoading: false,
        roleError:
          "Upload permission could not be checked. Refresh your account to try again.",
      });
  }
}
export async function loginWithEmail(email, password) {
  const c = await getFirebaseServices();
  return c.authSDK.signInWithEmailAndPassword(c.auth, email.trim(), password);
}
export async function createAccount(name, email, password) {
  if (password.length < 8)
    throw new Error("Use a password with at least 8 characters.");
  const c = await getFirebaseServices();
  const credential = await c.authSDK.createUserWithEmailAndPassword(
    c.auth,
    email.trim(),
    password,
  );
  if (name.trim())
    await c.authSDK.updateProfile(credential.user, {
      displayName: name.trim().slice(0, 100),
    });
  await c.authSDK.sendEmailVerification(credential.user);
  update({ user: userSummary(credential.user) });
  return credential;
}
export async function loginWithGoogle() {
  const c = await getFirebaseServices(),
    provider = new c.authSDK.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return c.authSDK.signInWithPopup(c.auth, provider);
}
export async function resetPassword(email) {
  const c = await getFirebaseServices();
  return c.authSDK.sendPasswordResetEmail(c.auth, email.trim());
}
export async function resendVerification() {
  const c = await getFirebaseServices();
  if (!c.auth.currentUser) throw new Error("Sign in first.");
  return c.authSDK.sendEmailVerification(c.auth.currentUser);
}
export async function reloadAccount() {
  const c = await getFirebaseServices();
  if (!c.auth.currentUser) return;
  await c.authSDK.reload(c.auth.currentUser);
  await c.auth.currentUser.getIdToken(true);
  await refreshRole();
}
export async function logout() {
  const c = await getFirebaseServices();
  return c.authSDK.signOut(c.auth);
}
