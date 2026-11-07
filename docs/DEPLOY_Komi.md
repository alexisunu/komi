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
| `PYTHON_VERSION` | `3.11.9` | La usada en el despliegue real. Render usa su versión por defecto si falta. |

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
  - `_redirects` no tiene reglas. Cualquier ruta que no sea un archivo devuelve `index.html` con 200
    porque Pages, si no hay un `404.html` en la raíz, trabaja en modo SPA. La regla
    `/*  /index.html  200` que se había puesto la descarta Pages ("Infinite loop detected") y no hace
    falta. **No añadir un `404.html`**: desactivaría ese comportamiento (lo vigila una prueba).
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
hacen en el bloque 5.2 con un perfil desechable (una ventana privada del navegador crea un
`profile_id` nuevo) y se limpian después con las consultas del apartado 10. Nunca con el perfil de
uso real.

## 7. Lista de comprobación

- [x] El nombre de `pages.dev` es definitivo y está apuntado (`komi-lectura-uwu`).
- [x] Supabase y Render en la misma región de la costa este de EE. UU. (Virginia y `us-east-1`).
- [ ] `DJANGO_DEBUG=false` y `DJANGO_SECRET_KEY` propia (no la de desarrollo).
- [ ] `DATABASE_URL` por el pooler en modo sesión, con `sslmode=require`.
- [ ] `CORS_ALLOWED_ORIGINS` es exactamente `https://NOMBRE.pages.dev`.
- [ ] `DJANGO_ALLOWED_HOSTS` es el host de Render.
- [ ] `GEMINI_API_KEY` solo en el panel de Render.
- [ ] `VITE_API_URL` es `https` y coincide con la URL de Render.
- [x] `/api/v1/health/` y `/api/v1/health/db/` responden 200.
- [x] CORS: el origen de Pages recibe la cabecera y otro origen no.
- [x] `sw.js` se sirve como JavaScript y con `no-cache`.
- [x] Una ruta inexistente de Pages devuelve el shell de la app.
- [x] El primer arranque en frío se midió (35,4 s, petición retenida, 200).
- [ ] La app, abierta con el servicio dormido, muestra "Despertando a Komi".
- [ ] El SSE en vivo funciona a través de Render y Cloudflare (la charla real).
- [ ] Ningún secreto está en el repositorio, en el chat ni en los registros.

## 8. Límites conocidos del plan gratuito

- **Arranque en frío** de Render: la primera petición tras ~15 min de inactividad tarda hasta ~60 s.
- **Supabase** pausa el proyecto tras días sin uso; mientras esté pausado la API falla.
- **Un despliegue o la suspensión** cortan los flujos SSE en curso: el candado de la charla caduca
  a los 90 s y el lector reintenta.
- Si más adelante se pone Cloudflare delante del backend, hay que revisar que no almacene en búfer
  el SSE (`X-Accel-Buffering: no` ya se envía).

## 9. Datos reales del despliegue (bloque 5.2, 7 de noviembre de 2026)

| Pieza | Valor |
|---|---|
| Frontend | `https://komi-lectura-uwu.pages.dev` (Cloudflare Pages, proyecto `komi-lectura-uwu`) |
| Backend | `https://komi-lectura-api.onrender.com` (Render, plan Free, Virginia, `PYTHON_VERSION` 3.11.9) |
| Base de datos | Supabase, proyecto `komi-lectura`, `us-east-1`, pooler en modo sesión, puerto 5432 |

Lo comprobado:

- **Arranque en frío de Render** (más de 20 minutos sin tráfico): la petición **se retiene** y
  responde `200` a los **35,4 s** (la conexión se abre en 0,13 s: todo el retraso está en el primer
  byte). Ya despierto: 0,25 s. No devolvió 502 ni 503. Cabe en el presupuesto de 90 s de la app.
- `/api/v1/health/` y `/api/v1/health/db/` devuelven 200 (`"database": "ok"`): las migraciones del
  comando de arranque se aplicaron en Supabase.
- **CORS:** un `GET` con `Origin: https://komi-lectura-uwu.pages.dev` recibe
  `access-control-allow-origin`; con otro origen, no. Con la variable `CORS_ALLOWED_ORIGINS` mal
  escrita (`.deV` en vez de `.dev`) no coincidía ningún origen y no había ni cabecera ni error: la
  coincidencia es exacta y distingue mayúsculas. La prueba fiable es el `GET` con `Origin` (un
  `OPTIONS` suelto con `curl` contesta 200 con `text/html` y no sirve para diagnosticar).
- **Pages:** `/` y `/sw.js` con `no-cache`; `sw.js` como `application/javascript`; una ruta
  inexistente devuelve el shell (200, `text/html`, `public, max-age=0, must-revalidate`). Pages
  descartó la regla `/*  /index.html  200` ("Infinite loop detected", 0 reglas de redirección válidas,
  8 de cabeceras) y el modo SPA nativo la hizo innecesaria: se quitó (apartado 5).
- La app cargó en una ventana privada con el Service Worker activo y sin errores en la consola.

## 10. Limpiar el perfil de una prueba (Supabase, editor SQL)

Para la charla real (y cualquier otra prueba contra el backend desplegado) se usa un perfil
desechable: una **ventana privada** del navegador abre la app con un `profile_id` nuevo, distinto del
del iPhone. Para que no haya confusión, el libro de esa prueba se llama `PRUEBA-BORRAR`.

**Cómo se identifica el perfil.** En esa ventana privada, en `https://komi-lectura-uwu.pages.dev`,
abrir las herramientas de desarrollo y ejecutar en la consola `localStorage.getItem("komi.profile_id")`
(o mirarlo en Application, Local Storage, clave `komi.profile_id`). Es un UUID. Quien lo tenga puede
leer los datos de ese perfil: no se publica ni se pega en el chat; solo en el editor SQL. **No cerrar
la ventana privada antes de copiarlo**: al cerrarla se pierde.

Las claves foráneas de Django no llevan `ON DELETE CASCADE` en la base (la cascada la hace el ORM),
así que un `DELETE` suelto del perfil falla: hay que borrar de abajo hacia arriba. El script lo hace
dentro de un bloque `DO`, que es una sola transacción: o se borra todo o nada.

**Paso 1: ver qué se borraría** (solo lectura). Sustituir `PEGA-AQUI-EL-UUID` por el UUID.

```sql
WITH p AS (SELECT 'PEGA-AQUI-EL-UUID'::uuid AS id)
SELECT 1 AS orden, 'perfil' AS tabla, r.id::text AS id,
       'meta ' || r.daily_goal_minutes || ' min, racha ' || r.current_streak AS detalle
FROM profiles_readerprofile r
WHERE r.id = (SELECT id FROM p)
UNION ALL
SELECT 2, 'libro', b.id::text,
       b.title || ' (' || b.format_type || ', ' || b.progress_percentage || '%)'
FROM garden_bookgarden b
WHERE b.profile_id = (SELECT id FROM p)
UNION ALL
SELECT 3, 'sesion', s.id::text, s.session_status || ', ' || s.actual_duration_sec || ' s'
FROM reading_sessions_readingsession s
JOIN garden_bookgarden b ON b.id = s.book_id
WHERE b.profile_id = (SELECT id FROM p)
UNION ALL
SELECT 4, 'charla', c.id::text, 'turno ' || c.turn_count || ', cerrada: ' || c.is_closed
FROM ai_companion_reflectionchat c
JOIN reading_sessions_readingsession s ON s.id = c.session_id
JOIN garden_bookgarden b ON b.id = s.book_id
WHERE b.profile_id = (SELECT id FROM p)
UNION ALL
SELECT 5, 'mensaje', m.id::text,
       m.sender || ', turno ' || m.turn_number || ' (' || length(m.content) || ' caracteres)'
FROM ai_companion_reflectionmessage m
JOIN ai_companion_reflectionchat c ON c.id = m.chat_id
JOIN reading_sessions_readingsession s ON s.id = c.session_id
JOIN garden_bookgarden b ON b.id = s.book_id
WHERE b.profile_id = (SELECT id FROM p)
ORDER BY 1, 3;
```

Revisar el resultado: debe haber **una** fila de perfil, un libro llamado `PRUEBA-BORRAR`, y solo la
sesión, la charla y los mensajes de esa prueba. Si el libro no es el de la prueba, parar.

**Paso 2: borrar** (solo después de revisar el paso 1; usar el mismo UUID). El bloque se niega a
borrar si el perfil no existe o si tiene más de 3 libros (no parece uno de prueba).

```sql
DO $$
DECLARE
  pid uuid := 'PEGA-AQUI-EL-UUID';
  n_libros integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles_readerprofile WHERE id = pid) THEN
    RAISE EXCEPTION 'No existe un perfil con ese UUID: no se borra nada';
  END IF;
  SELECT count(*) INTO n_libros FROM garden_bookgarden WHERE profile_id = pid;
  IF n_libros > 3 THEN
    RAISE EXCEPTION 'El perfil tiene % libros: no parece el de prueba, no se borra nada', n_libros;
  END IF;

  DELETE FROM ai_companion_reflectionmessage
  WHERE chat_id IN (
    SELECT c.id FROM ai_companion_reflectionchat c
    JOIN reading_sessions_readingsession s ON s.id = c.session_id
    JOIN garden_bookgarden b ON b.id = s.book_id
    WHERE b.profile_id = pid);
  DELETE FROM ai_companion_reflectionchat
  WHERE session_id IN (
    SELECT s.id FROM reading_sessions_readingsession s
    JOIN garden_bookgarden b ON b.id = s.book_id
    WHERE b.profile_id = pid);
  DELETE FROM reading_sessions_readingsession
  WHERE book_id IN (SELECT id FROM garden_bookgarden WHERE profile_id = pid);
  DELETE FROM garden_bookgarden WHERE profile_id = pid;
  DELETE FROM profiles_readerprofile WHERE id = pid;
END $$;
```

**Paso 3: comprobar.** Volver a ejecutar la consulta del paso 1: no debe devolver ninguna fila.
