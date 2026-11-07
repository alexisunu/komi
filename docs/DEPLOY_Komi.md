# Despliegue de Komi v1.0 (Fase 5)

Guía y lista de comprobación para publicar Komi con hosting gratuito. Decisiones tomadas con el
autor (SRS §19, punto 23):

- **Frontend:** Cloudflare Pages, en el subdominio gratuito `NOMBRE.pages.dev`. El nombre se elige
  UNA vez y no cambia: IndexedDB y el Service Worker pertenecen al origen, y cambiar de dominio deja
  al iPhone sin sus datos locales.
- **Backend:** Render (servicio web gratuito, un solo proceso de `uvicorn`, sin `gunicorn`).
- **Base de datos:** Supabase (PostgreSQL), conexión por el pooler en **modo sesión**.
- **Región:** Render y Supabase en la costa este de EE. UU. (Render Virginia o Ohio, Supabase
  `us-east-1` u `us-east-2`; comprobar las regiones vigentes en cada panel antes de crear nada).
- **Secretos:** nunca se pegan en el chat, en el repositorio ni en los registros. Se escriben solo
  en el panel de cada servicio.

## 1. Variables de entorno

### Backend (Render)

| Variable | Valor | Notas |
|---|---|---|
| `DJANGO_SECRET_KEY` | cadena aleatoria larga | `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `DJANGO_DEBUG` | `false` | |
| `DJANGO_ALLOWED_HOSTS` | `NOMBRE-api.onrender.com` | El host que asigna Render, sin `https://`. |
| `DATABASE_URL` | URL del pooler en modo sesión | Ver §3. Termina en `?sslmode=require&connect_timeout=10`. |
| `DB_CONN_MAX_AGE` | `0` | Cada conexión ocupa un hueco del pooler. |
| `GEMINI_API_KEY` | clave de Google AI Studio | Solo en este panel. |
| `GEMINI_PRIMARY_MODEL` | ver `.env.example` | Revisar en AI Studio: los modelos cambian. |
| `GEMINI_FALLBACK_MODEL` | ver `.env.example` | |
| `CORS_ALLOWED_ORIGINS` | `https://NOMBRE.pages.dev` | Origen exacto: sin barra final ni ruta, `https`. |
| `PYTHON_VERSION` | `3.12.x` | Render usa su propia versión por defecto si falta. |

### Frontend (Cloudflare Pages)

| Variable | Valor | Notas |
|---|---|---|
| `VITE_API_URL` | `https://NOMBRE-api.onrender.com` | Sin barra final. Se fija AL COMPILAR: si cambia, hay que volver a desplegar. |
| `NODE_VERSION` | `20` | El proyecto exige Node 20.19 o superior. |

## 2. Orden de creación

Las URL se necesitan entre sí, así que se fijan los nombres antes de crear nada:

1. Elegir el nombre definitivo de Pages (`NOMBRE.pages.dev`) y el del servicio de Render.
2. Supabase: crear el proyecto y copiar la URL del pooler (§3).
3. Render: crear el servicio con todas las variables de §1 (el origen CORS ya se conoce).
4. Cloudflare Pages: crear el proyecto con `VITE_API_URL` apuntando a Render.
5. Pruebas de humo (§5).

## 3. Supabase

1. Crear el proyecto en la región `us-east-*`. La contraseña de la base de datos se guarda en un
   gestor de contraseñas, no en el chat.
2. Panel del proyecto, botón **Connect**, cadena **Session pooler** (puerto 5432 del host del
   pooler, no la conexión directa: suele ser solo IPv6 y Render puede no tener salida IPv6).
3. El usuario tiene la forma `postgres.<referencia-del-proyecto>`. Si la contraseña tiene
   caracteres especiales se escribe con `%`-escapes (`@` = `%40`, `/` = `%2F`, `:` = `%3A`).
4. Añadir `?sslmode=require&connect_timeout=10` al final. `config/dburl.py` solo admite esos dos
   parámetros y rechaza cualquier otro.
5. Límites del plan gratuito (revisar los vigentes): el proyecto se **pausa tras días sin uso** y
   hay que reanudarlo a mano en el panel; el pooler tiene un número limitado de conexiones.

## 4. Render (backend)

- **Root Directory:** `komi_backend`
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:**
  `python manage.py migrate --noinput && uvicorn config.asgi:application --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*"`
  Un solo worker (el valor por defecto): no añadir `--workers`. `--proxy-headers` hace que Django vea
  `https` detrás del proxy de Render. La migración corre en el arranque porque el "Pre-Deploy
  Command" puede no estar disponible en el plan gratuito (comprobarlo); `migrate` es idempotente.
- **Health Check Path:** `/api/v1/health/` (no toca la base de datos; un fallo puntual de la base
  de datos no debe reiniciar el servicio). `/api/v1/health/db/` hace `SELECT 1` y sirve para las
  pruebas de humo.
- **Plan gratuito:** el servicio se duerme tras unos 15 min sin tráfico y tarda hasta ~60 s en
  despertar. La app lo sondea al abrirse y muestra "Despertando a Komi" (espera de hasta 90 s);
  la sincronización y la charla esperan a que responda.
- **Sin dependencias nuevas:** no hay `gunicorn`, `whitenoise` ni `dj-database-url`. La API no
  sirve archivos estáticos.

## 5. Cloudflare Pages (frontend)

- **Root directory:** `komi_frontend`
- **Build command:** `npm ci && npm run build`
- **Output directory:** `dist`
- `public/_headers` y `public/_redirects` se copian a `dist/` al compilar:
  - `sw.js`, `index.html`, `/` y `manifest.webmanifest`: `Cache-Control: no-cache`.
  - `/assets/*` (nombres con hash): `public, max-age=31536000, immutable`.
  - Cualquier ruta devuelve `index.html` con estado 200.
- Tras cada despliegue comprobar que `https://NOMBRE.pages.dev/sw.js` se sirve como JavaScript (no
  como HTML) y con `Cache-Control: no-cache`.

## 6. Pruebas de humo (después de desplegar)

Sustituir `API` y `WEB`. Ninguna lleva datos del lector ni secretos.

```bash
API=https://NOMBRE-api.onrender.com
WEB=https://NOMBRE.pages.dev

# 1. Proceso vivo (la primera vez puede tardar ~60 s: es el arranque en frio)
curl -s -w "\n%{http_code} %{time_total}s\n" "$API/api/v1/health/"
# 2. Base de datos
curl -s -w "\n%{http_code}\n" "$API/api/v1/health/db/"
# 3. CORS: solo el origen del frontend recibe la cabecera
curl -si -H "Origin: $WEB" "$API/api/v1/health/" | grep -i access-control-allow-origin
curl -si -H "Origin: https://otro.example.com" "$API/api/v1/health/" | grep -ci access-control-allow-origin   # debe dar 0
# 4. Pages: el Service Worker
curl -sI "$WEB/sw.js" | grep -iE "content-type|cache-control"
# 5. Pages: una ruta cualquiera devuelve el shell
curl -s -o /dev/null -w "%{http_code}\n" "$WEB/una/ruta/cualquiera"
```

La prueba del SSE en vivo (`curl -N`) y la **única charla real** contra el backend desplegado se
hacen en el bloque 5.2 con una base de datos de pruebas aparte, nunca con la de uso real.

## 7. Lista de comprobación

- [ ] El nombre de `pages.dev` es definitivo y está apuntado.
- [ ] Supabase y Render en la misma región de la costa este de EE. UU.
- [ ] `DJANGO_DEBUG=false` y `DJANGO_SECRET_KEY` propia (no la de desarrollo).
- [ ] `DATABASE_URL` por el pooler en modo sesión, con `sslmode=require`.
- [ ] `CORS_ALLOWED_ORIGINS` es exactamente `https://NOMBRE.pages.dev`.
- [ ] `DJANGO_ALLOWED_HOSTS` es el host de Render.
- [ ] `GEMINI_API_KEY` solo en el panel de Render.
- [ ] `VITE_API_URL` es `https` y coincide con la URL de Render.
- [ ] `/api/v1/health/` y `/api/v1/health/db/` responden 200.
- [ ] CORS: el origen de Pages recibe la cabecera y otro origen no.
- [ ] `sw.js` se sirve como JavaScript y con `no-cache`.
- [ ] Una ruta inexistente de Pages devuelve el shell de la app.
- [ ] El primer arranque en frío se midió y la app muestra "Despertando a Komi".
- [ ] Ningún secreto está en el repositorio, en el chat ni en los registros.

## 8. Límites conocidos del plan gratuito

- **Arranque en frío** de Render: la primera petición tras ~15 min de inactividad tarda hasta ~60 s.
- **Supabase** pausa el proyecto tras días sin uso; mientras esté pausado la API falla.
- **Un despliegue o la suspensión** cortan los flujos SSE en curso: el candado de la charla caduca
  a los 90 s y el lector reintenta.
- Si más adelante se pone Cloudflare delante del backend, hay que revisar que no almacene en búfer
  el SSE (`X-Accel-Buffering: no` ya se envía).
