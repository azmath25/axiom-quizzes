import {
  $,
  $$,
  mountShell,
  escapeHTML,
  icon,
  toast,
  downloadFile,
  slug,
  formatNumber,
  formatTime,
} from "./common.js";
import {
  initFirebase,
  getSession,
  watchSession,
  loginWithEmail,
  loginWithGoogle,
  createAccount,
  resetPassword,
  resendVerification,
  reloadAccount,
  logout,
} from "./firebase-client.js";
import { canPublish, firebaseError, safeReturnURL } from "./firebase-core.js";
import { cloudRepository } from "./cloud-repository.js";

mountShell("account");
const root = $("#main"),
  returnTo = new URLSearchParams(location.search).get("returnTo");
let mode = "login",
  busy = false,
  generation = 0;
function feedback(message, error = false) {
  const el = $("#auth-feedback");
  if (!el) return;
  el.hidden = false;
  el.className = `notice ${error ? "error" : ""} auth-feedback`;
  el.textContent = message;
}
function formPage(session) {
  const enabled = session.status === "ready";
  document.title = `${mode === "register" ? "Create account" : mode === "reset" ? "Reset password" : "Sign in"} · Math quizzes`;
  root.innerHTML = `<div class="auth-layout"><section class="panel auth-card"><div class="auth-heading"><h1>${mode === "register" ? "Create account" : mode === "reset" ? "Reset password" : "Sign in"}</h1></div><div class="panel-body">${!enabled ? `<div class="notice warning auth-feedback">${session.status === "connecting" ? "Loading sign-in…" : "Sign-in is not available yet. You can continue using quizzes without an account."}</div>` : ""}<div id="auth-feedback" class="auth-feedback" role="status" hidden></div>${mode !== "reset" ? `<div class="auth-tabs"><button id="mode-login" class="${mode === "login" ? "active" : ""}">Sign in</button><button id="mode-register" class="${mode === "register" ? "active" : ""}">Create account</button></div>` : ""}<form id="auth-form"><fieldset ${!enabled ? "disabled" : ""} style="padding:0;margin:0;border:0;min-width:0"><div class="auth-form">${mode === "register" ? '<label>Full name<input name="displayName" autocomplete="name" maxlength="100" required></label>' : ""}<label>Email<input type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label>${mode !== "reset" ? `<label>Password<div class="password-field"><input type="password" id="password" name="password" autocomplete="${mode === "register" ? "new-password" : "current-password"}" minlength="${mode === "register" ? 8 : 1}" required><button type="button" id="show-password" aria-pressed="false">Show</button></div></label>` : ""}${mode === "register" ? '<label>Confirm password<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required></label><p class="field-help">Use at least 8 characters.</p>' : ""}<button class="button primary" type="submit" id="auth-submit">${mode === "register" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button></div>${mode !== "reset" ? '<div class="auth-separator">or</div><button class="google-button" type="button" id="google-login"><span class="google-g" aria-hidden="true">G</span> Continue with Google</button>' : ""}</fieldset></form><div class="auth-form-foot">${mode === "reset" ? '<button class="text-button" id="back-signin">Back to sign in</button>' : '<button class="text-button" id="forgot-password">Forgot password?</button>'}<a href="./index.html" class="muted">Continue without an account</a></div></div></section><aside class="auth-aside"><section class="access-panel"><h2>Account access</h2><ul><li><strong>Students</strong><span>Take quizzes and save completed results to an account.</span></li><li><strong>Teachers</strong><span>Upload quiz files, publish them, and manage private drafts.</span></li><li><strong>On this device</strong><span>Import, preview, and export files without signing in.</span></li></ul></section>${!enabled ? '<div class="notice">Taking a quiz does not require an account.</div>' : '<div class="notice">Upload access is granted by the site owner.</div>'}</aside></div>`;
  $("#mode-login")?.addEventListener("click", () => {
    mode = "login";
    formPage(getSession());
  });
  $("#mode-register")?.addEventListener("click", () => {
    mode = "register";
    formPage(getSession());
  });
  $("#forgot-password")?.addEventListener("click", () => {
    mode = "reset";
    formPage(getSession());
  });
  $("#back-signin")?.addEventListener("click", () => {
    mode = "login";
    formPage(getSession());
  });
  $("#show-password")?.addEventListener("click", () => {
    const field = $("#password"),
      show = field.type === "password";
    field.type = show ? "text" : "password";
    $("#show-password").textContent = show ? "Hide" : "Show";
    $("#show-password").setAttribute("aria-pressed", show);
  });
  $("#auth-form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !enabled) return;
    const form = new FormData(event.currentTarget),
      email = String(form.get("email") || ""),
      password = String(form.get("password") || "");
    if (mode === "register" && password !== form.get("confirmPassword")) {
      feedback("The passwords do not match.", true);
      return;
    }
    busy = true;
    $("#auth-submit").disabled = true;
    try {
      if (mode === "reset") {
        await resetPassword(email);
        feedback(
          "If this email has an account, a password-reset link has been sent.",
        );
      } else if (mode === "register") {
        await createAccount(
          String(form.get("displayName") || ""),
          email,
          password,
        );
        feedback(
          "Account created. Check your email for the verification link.",
        );
      } else {
        await loginWithEmail(email, password);
        if (returnTo) location.href = safeReturnURL(returnTo, location.href);
      }
    } catch (error) {
      feedback(firebaseError(error), true);
    } finally {
      busy = false;
      if ($("#auth-submit"))
        $("#auth-submit").disabled = getSession().status !== "ready";
    }
  };
  $("#google-login")?.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    $("#google-login").disabled = true;
    try {
      await loginWithGoogle();
      if (returnTo) location.href = safeReturnURL(returnTo, location.href);
    } catch (error) {
      feedback(firebaseError(error), true);
    } finally {
      busy = false;
      if ($("#google-login"))
        $("#google-login").disabled = getSession().status !== "ready";
    }
  });
}
async function accountPage(session) {
  const run = ++generation,
    user = session.user;
  document.title = "Account · Math quizzes";
  root.innerHTML = `<section class="page-heading"><div><h1>Account</h1></div></section><div id="auth-feedback" class="auth-feedback" role="status" hidden></div><div class="account-layout"><section class="panel"><div class="panel-heading"><h2>Profile</h2></div><div class="panel-body account-profile"><div class="profile-name">${escapeHTML(user.displayName || "Account")}</div><div class="profile-email">${escapeHTML(user.email)}</div><div class="profile-badges"><span class="badge ${["teacher", "admin"].includes(session.role) ? "green" : "gray"}">${escapeHTML(session.role[0].toUpperCase() + session.role.slice(1))}</span><span class="badge ${user.emailVerified ? "green" : "amber"}">${user.emailVerified ? "Email verified" : "Email not verified"}</span></div><p class="field-help">${session.roleLoading ? "Checking upload access…" : canPublish(session) ? "Upload access is enabled for your account." : !user.emailVerified && ["teacher", "admin"].includes(session.role) ? "Verify your email to use your upload access." : "Upload access is not enabled for your account."}</p><details class="account-id"><summary>Account ID</summary><code>${escapeHTML(user.uid)}</code></details><div class="profile-actions">${!user.emailVerified ? '<button class="button secondary" id="resend-verification">Send verification email</button>' : ""}<button class="button secondary" id="refresh-account">${icon("refresh")} Refresh account</button>${canPublish(session) ? `<a class="button primary" href="./upload.html">${icon("upload")} Upload quiz</a>` : ""}<button class="button danger" id="sign-out">Sign out</button></div>${session.roleError ? `<div class="notice warning">${escapeHTML(session.roleError)}</div>` : ""}</div></section><section class="panel"><div class="panel-heading"><h2>Recent results</h2><span class="subtle">Latest 30</span></div><div id="account-results" class="account-results"><div class="loading-state">Loading results…</div></div></section></div>`;
  $("#sign-out").onclick = async () => {
    try {
      await logout();
    } catch (e) {
      feedback(firebaseError(e), true);
    }
  };
  $("#refresh-account").onclick = async () => {
    try {
      await reloadAccount();
      toast("Account refreshed.");
    } catch (e) {
      feedback(firebaseError(e), true);
    }
  };
  $("#resend-verification")?.addEventListener("click", async () => {
    try {
      await resendVerification();
      feedback(
        "Verification email sent. Open its link, then refresh your account.",
      );
    } catch (e) {
      feedback(firebaseError(e), true);
    }
  });
  try {
    const rows = await (await cloudRepository()).results();
    if (run !== generation || getSession().user?.uid !== user.uid) return;
    $("#account-results").innerHTML = rows.length
      ? rows
          .map(
            (row, i) =>
              `<div class="account-result"><div><h3>${escapeHTML(row.quizTitle)}</h3><small>${escapeHTML(new Date(row.submittedAt).toLocaleDateString())} · ${formatTime(row.timeTakenSeconds)}${row.pending ? " · Self-marking pending" : ""}</small><button class="text-button" data-download-result="${i}">Download result</button></div><div class="account-result-score">${formatNumber(row.score)} <span>/ ${formatNumber(row.possible)}</span></div></div>`,
          )
          .join("")
      : '<div class="panel-body"><p class="muted" style="font-size:13px">No account results yet. Complete a quiz while signed in to save its result here.</p></div>';
    $$("[data-download-result]").forEach(
      (button) =>
        (button.onclick = () => {
          const row = rows[Number(button.dataset.downloadResult)];
          downloadFile(row, `${slug(row.quizTitle)}-result.json`);
        }),
    );
  } catch (error) {
    if (run === generation && getSession().user?.uid === user.uid)
      $("#account-results").innerHTML =
        `<div class="panel-body"><div class="notice warning">${escapeHTML(firebaseError(error))}</div></div>`;
  }
}
watchSession((session) => {
  if (session.user) accountPage(session);
  else {
    generation++;
    formPage(session);
  }
});
initFirebase();
