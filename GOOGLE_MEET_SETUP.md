# Google Meet auto-generation (4 steps)

Your app creates a Google Calendar event with Meet when someone books (or when you confirm a group call). The Meet link is then inserted into confirmation emails.

## Step 1 — Use your **Calls** calendar ID

1. Open [Google Calendar](https://calendar.google.com).
2. Find your **Calls** calendar → **Settings and sharing**.
3. Scroll to **Integrate calendar** → copy **Calendar ID** (often an email-like string).
4. In Railway → **jens-booking** → **Variables** set:
   ```
   GOOGLE_CALENDAR_ID=<your Calls calendar ID>
   ```
5. Redeploy.

## Step 2 — OAuth client (Google Cloud)

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services.
2. Enable **Google Calendar API**.
3. **Credentials** → **OAuth 2.0 Client ID** (Web application).
4. Add redirect URI:
   ```
   https://jens-booking-production.up.railway.app/auth/callback
   ```
5. Copy **Client ID** and **Client secret** to Railway:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`

## Step 3 — Refresh token (one-time login)

1. Open in browser:
   ```
   https://jens-booking-production.up.railway.app/auth/login
   ```
2. Sign in with the Google account that owns the **Calls** calendar.
3. Copy the **refresh token** from the page.
4. Set Railway variable:
   ```
   GOOGLE_OAUTH_REFRESH_TOKEN=<paste token>
   ```
5. Redeploy.

## Step 4 — Test + guest email delivery

1. Book a test **Open Connection** slot on your live site.
2. Railway logs should show **no** `Calendar event creation failed`.
3. Your owner email should include a **Meet** link.
4. The booker must receive email too:
   - Until Resend domain is verified: set `EMAIL_USER` + `EMAIL_PASS` (Gmail **app password**).
   - After Resend domain works: set `RESEND_FROM` on your verified subdomain.

## If Meet is still missing

| Log / symptom | Fix |
|---------------|-----|
| `GOOGLE_CALENDAR_ID is not set` | Step 1 |
| `invalid_grant` | Repeat Step 3 (new refresh token) |
| Event created, no Meet | Account must allow Meet; retry after Step 3 |
| Owner email has Meet, booker does not | Email delivery (Gmail SMTP or Resend domain), not calendar |

Group calls: Meet is created when you click **Confirm call** in Admin → Group scheduling.
