# PU WebGIS - Punjab University New Campus

Leaflet + PostGIS ka campus map. Ab ye ek **secure, installable PWA** hai jo
cloud par 24/7 chalta hai - laptop band ho jaye tab bhi.

---

## 1. Kya kya badla (v1 -> v2)

### Security (8/10+)

| Pehle | Ab |
|---|---|
| DB password `123` aur JWT secret source code mein likhe the | Sab `.env` se aate hain; production mein `JWT_SECRET` na ho to server chalu hi nahi hota |
| `cors()` poori tarah khula tha | Sirf `ALLOWED_ORIGINS` wale origins; default par sirf same-origin |
| Koi security header nahi | `helmet` - strict CSP, HSTS, clickjacking protection, `Permissions-Policy: geolocation=(self)` |
| Token `localStorage` mein (XSS se chori ho sakta tha) | **httpOnly + SameSite=Strict cookie** + double-submit CSRF token |
| Rate limiter memory mein tha (restart par reset, leak) | `express-rate-limit`, failed-login pe hi count hota hai |
| `err.message` seedha client ko bhejta tha (schema leak) | Production mein generic error; asli error sirf server log mein |
| `trust proxy` nahi tha (Render par IP galat aati) | `trust proxy = 1`, `req.ip` aur `req.secure` ab sahi hain |
| Body size limit nahi | `100kb` limit, malformed JSON par saaf 400 |

### PWA

- `manifest.json` (sirf `manifest.JSON` nahi - **Linux par 404 hota tha**, PWA install hi nahi hota tha)
- Naya service worker: app shell + Leaflet precache, offline page, network-first navigation
- Leaflet ab **local** hai (`public/vendor/`) - offline bhi chalta hai, CDN par depend nahi
- Maskable icon, iOS meta tags, install button, `display_override`

### Performance

- `compression` (gzip), connection pool config, static cache headers
- `sw.js` cache-first static + stale-while-revalidate
- Bundle: koi CDN round-trip nahi

### Accessibility (WCAG 2.1 AA)

- `lang` attribute, skip link, real `<label>` elements
- Modal: `role="dialog"`, focus trap, Esc se band, focus restore
- Toast/status: `aria-live="polite"`
- Focus ring har interactive element par
- Contrast puri tarah theek (pehle ka green button 2.9:1 tha, ab 5.9:1)
- Pinch zoom allowed, `prefers-reduced-motion` supported

---

## 2. Local chalana

```bash
cd C:\Users\hanzl\webgis-api
npm install
npm run migrate     # sirf nayi database ke liye
npm start
```

Ya Windows par `start.bat` double-click karein.

Browser: <http://localhost:3000>

---

## 3. Environment variables

`.env.example` copy karke `.env` banayein. Poori list wahan hai.

| Variable | Kaam |
|---|---|
| `DATABASE_URL` | Cloud PostgreSQL ka connection string. Khali chhorein to local `DB_*` use honge |
| `DB_SSL` | Cloud par `true` rakhein (default `DATABASE_URL` set karte hi `true`) |
| `JWT_SECRET` | 32+ characters. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODE_ENV` | Production par `production` |
| `PORT` | Render khud deta hai - haath se mat likhein |
| `TRUST_PROXY_HOPS` | Render = `1` |
| `JOIN_CODE` | Naye user ka registration code. Khali chhorein to koi bhi account bana sakta hai |
| `ALLOWED_ORIGINS` | Sirf tab chahiye jab frontend alag domain par ho |

---

## 4. Deploy karna (24/7, laptop band ho jaye tab bhi)

### 4a. Cloud database (Supabase ya Neon - dono ka free tier hai)

1. [supabase.com](https://supabase.com) ya [neon.tech](https://neon.tech) par account banayein
2. Naya PostgreSQL project banayein
3. Connection string copy karein:
   `postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require`
4. PostGIS on karein:
   - Supabase: Dashboard -> Database -> Extensions -> `postgis` enable
   - Neon: SQL Editor mein `CREATE EXTENSION postgis;`
5. `npm run migrate` chala kar tables bana lein

### 4b. Render par web service

1. Code GitHub par push karein
2. [render.com](https://render.com) -> **New** -> **Blueprint** -> repo select
3. `render.yaml` khud read ho jayega
4. Render dashboard mein ye variables set karein:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Supabase/Neon ki connection string |
   | `JWT_SECRET` | `generateValue: true` (ya apna) |
   | `DB_SSL` | `true` |
   | `JOIN_CODE` | apna registration code |
   | `NODE_ENV` | `production` |

5. Deploy. Health check `/api/health` par lagaya gaya hai.

> **Note:** `render.yaml` mein Render ka apna free Postgres bhi hai, lekin woh
> **30 din** ke baad expire ho jata hai. Is liye Supabase/Neon behtar hai -
> woh free par chalta rehta hai.

Deploy ke baad `https://<your-app>.onrender.com` par app chal jayega.
Pehli baar Render free tier par thoda slow hota hai (server sleep).

---

## 5. Phone par install (PWA)

1. App kholein (HTTPS zaroori hai)
2. Chrome (Android): menu -> **Add to Home screen** / **Install app**
3. iOS Safari: Share -> **Add to Home Screen**
4. Offline chalta hai - pehle se download map dikhta rahega

---

## 6. HTTPS aur Geolocation

Browser **sirf HTTPS ya localhost** par Geolocation API deta hai. Is liye:

- Production par server HTTP requests ko HTTPS par redirect karta hai
- `helmet` HSTS header bhejta hai (1 saal)
- `Permissions-Policy: geolocation=(self)` sirf app ko location deta hai
- App agar HTTP par chal rahi ho to upar laal warning bar lagta hai

Local testing ke liye HTTPS tunnel chahiye:

```bash
npx localtunnel --port 3000
# ya
ngrok http 3000
```

Phir us HTTPS URL par app kholein - location kaam karegi.

---

## 7. Zyada commands

```bash
npm start        # production start
npm run dev      # auto-reload
npm run migrate  # database schema
npm run check    # syntax check saari JS files ki
```

---

## 8. Agar kuch na chale

| Problem | Hal |
|---|---|
| `FATAL: JWT_SECRET must be set` | `.env` mein `JWT_SECRET` daalein |
| `relation "public.users" does not exist` | `npm run migrate` chalaayein |
| `PostGIS extension` error | DB admin se `CREATE EXTENSION postgis;` |
| Location nahi mil rahi | HTTPS check karein, browser ki location permission dein |
| PWA install nahi ho raha | `manifest.json` lowercase hai? DevTools -> Application -> Manifest check karein |
| `429` error aa raha hai | Rate limit lag gaya - 15 minute wait karein |

---

## 9. Purana code kahan hai?

Sab kuch `C:\Users\hanzl\webgis-api-backup` mein copy hai (node_modules ke ilawa).
Wapas jana ho to `.env.example` ke ilawa wahan ki files copy kar dein.

---

## 10. Rollback (purana version wapas chahiye)

```bash
cd C:\Users\hanzl
robocopy webgis-api-backup webgis-api /E /XD node_modules
cd webgis-api
npm install
```
