# Auth setup — Supabase + Google + Microsoft OAuth

This is a one-time setup. After you finish, **every user who installs the add-in can sign up with one click** — no env vars, no Supabase project of their own.

The Supabase **anon key** is designed to be public. It's safe to commit to git and ship to every user's browser. Row-level security (RLS) on your database is what protects user data.

**Time required:** ~20 minutes.

---

## Part 1 — Create the Supabase project (5 min)

1. Go to https://supabase.com/dashboard and sign in (free).
2. Click **New project**.
3. Pick a name, a strong DB password (you won't need it day-to-day), a region close to your users.
4. Wait ~2 minutes for provisioning.
5. Open **Project Settings → API**.
6. Copy two things:
   - **Project URL** — looks like `https://abcdefghijklmnop.supabase.co`
   - **Project API keys → anon public** — long string starting with `eyJ...`

---

## Part 2 — Paste them into the code (30 sec)

Open `public/index.html`, search for `SUPABASE_CONFIG`, and replace the placeholders:

```js
const SUPABASE_CONFIG = {
  url:     'https://abcdefghijklmnop.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...'
};
```

Commit. From now on, every user who clones the repo and runs `npm start` gets sign-in for free.

---

## Part 3 — Enable Google OAuth (5 min)

### 3.1 — Create a Google OAuth client

1. Go to https://console.cloud.google.com/apis/credentials.
2. Create or pick a project.
3. **OAuth consent screen** (if not done):
   - User Type → **External**
   - App name → "Excel AI Assistant" (or whatever)
   - Support email → your email
   - Authorized domains → `supabase.co`
   - Save and continue. Scopes can stay empty. Add yourself as a test user if you keep the app in "Testing" status — or click **Publish app** to make it available to everyone.
4. **Credentials → Create Credentials → OAuth client ID**:
   - Application type → **Web application**
   - Name → "Excel AI"
   - **Authorized redirect URIs** → add this exact URL (replace the placeholder with your Supabase project ref):
     ```
     https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
     ```
     You can find the exact URL in Supabase under **Authentication → Providers → Google** — it's labeled "Callback URL (for OAuth)".
5. Save. Copy the **Client ID** and **Client Secret**.

### 3.2 — Tell Supabase about it

1. In Supabase: **Authentication → Providers → Google**.
2. Toggle **Enable Sign in with Google**.
3. Paste the Client ID and Client Secret.
4. Save.

Done. Now `signInWithOAuth('google')` works.

---

## Part 4 — Enable Microsoft OAuth (8 min)

### 4.1 — Create an Azure app registration

1. Go to https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade.
2. Click **New registration**.
3. **Name** → "Excel AI Assistant" (or whatever).
4. **Supported account types** → select **Accounts in any organizational directory (Any Azure AD directory — Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**.
   - This is what makes both personal Outlook accounts AND work/school accounts work.
5. **Redirect URI**:
   - Platform → **Web**
   - URL → `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
     (find the exact URL in Supabase under **Authentication → Providers → Azure**.)
6. Register.

### 4.2 — Get the Application (client) ID + secret

1. On the app overview page, copy the **Application (client) ID**.
2. **Certificates & secrets → New client secret**.
3. Description → "Supabase OAuth", expiry → 24 months (or whatever you prefer).
4. Add. **Copy the secret VALUE immediately** (not the ID) — it won't be shown again.

### 4.3 — Add API permissions (optional but recommended)

1. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.
2. Add: `openid`, `email`, `profile`, `User.Read`.
3. Save.

### 4.4 — Tell Supabase about it

1. In Supabase: **Authentication → Providers → Azure**.
2. Toggle **Enable Sign in with Azure**.
3. Paste:
   - **Application (Client) ID** — the one from step 4.2
   - **Secret Value** — the secret value (not its ID)
   - **Azure Tenant ID** → leave blank for multi-tenant + personal account support, OR enter `common` explicitly.
4. Save.

---

## Part 5 — Test it

1. `npm start`
2. Sideload the add-in into Excel (see main README).
3. Open the task pane → click the **→** account icon → modal opens.
4. Click **Continue with Google**. A popup opens.
5. Sign in. Popup closes. You should see your initials in the account icon.
6. Repeat for Microsoft.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| "Popup blocked" | Browser blocked the OAuth popup | Allow popups for `https://localhost:3000`. In Excel desktop, Office uses Edge WebView — popups are usually allowed by default. |
| "redirect_uri_mismatch" | Google/Azure don't recognize the redirect URL | The redirect URI in Google Cloud / Azure portal must be **exactly** `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` — no trailing slash, exact case. |
| "Invalid OAuth state" | Cookies blocked or session lost between popup and main window | Make sure the popup and main window are on the same origin (`https://localhost:3000`). |
| "AADSTS50194: Application is not configured as a multi-tenant application" | Azure app set to single-tenant | In Azure: Authentication → **Supported account types** → switch to multi-tenant + personal accounts. |
| Sign-in succeeds but `currentUser` stays null | postMessage didn't reach the opener | Check the browser console in the main window. The `/auth/callback` page must postMessage `{ type: 'supabase-auth-callback', hash: window.location.hash }`. |

---

## What happens when you ship as a real installer (Path C)

Once you bundle this into an Electron/Tauri app, the origin changes from `https://localhost:3000` to something like `app://excel-ai` or `https://app.yourdomain.com`. You'll need to:

1. Add the new origin as an additional **redirect URI** in both Google Cloud and Azure portal.
2. Add the new origin to Supabase under **Authentication → URL Configuration → Site URL** and **Redirect URLs**.
3. Update `/auth/callback` to handle the new origin (it already does — `window.location.origin` is used dynamically).

Nothing in the code needs to change — only the OAuth provider dashboards.

---

## What if I want to disable OAuth for a particular install?

Just delete the buttons from the auth modal in `public/index.html` (the two `<button class="auth-social-btn">…` blocks). Email/password sign-in keeps working.
