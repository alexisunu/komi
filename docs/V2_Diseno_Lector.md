# Komi v2 - Diseno del lector, modo libre y Dashboard

Complementa `docs/V2_Pendientes_Komi.md`. Referencia visual en `docs/v2_mockups/` (PNG, cada una con tema claro y oscuro). Si algo contradice el SRS en tokens, manda el SRS; esto modifica el SRS solo en lo indicado en "Cambios al SRS". Los puntos marcados "por confirmar" requieren decision antes de implementar.

## 1. Alcance v2 (lista cerrada)

1. Lector EPUB: boton para ocultar la interfaz y que el texto ocupe toda la pantalla.
2. Menu flotante con iconos dentro del lector (Hablar con Komi, Terminar sesion, Tamano de letra, Modo noche/dia, Mostrar interfaz).
3. Modo libre: cronometro ascendente, sin limite, para registrar el tiempo real de lectura.
4. Selector "Temporizador | Libre" en el Dashboard (reemplaza una pantalla de eleccion separada; recuerda la ultima eleccion, por defecto Temporizador).
5. Animacion de pasar pagina (deslizamiento horizontal, 320 ms ease-out).
6. Ocultar (no eliminar) el componente de racha y la seccion Estadisticas: se quitan de la interfaz, pero el codigo y el backend se conservan para poder reactivarlos en el futuro.
7. Navegacion inferior de dos items: "Lectura" y "Mi Jardin".
8. Libro fisico: sonido al terminar el tiempo del temporizador.
9. Margenes y tipografia del lector segun SRS 10.8 (margen lateral 24 px, Lora, interlineado 1.6; texto justificado con `hyphens: auto` y `lang="es"` para evitar huecos grandes entre palabras; el SRS 10.8 ya fue actualizado).
10. Pendientes Android de `V2_Pendientes_Komi.md`: (1) .ics no importable en Google Calendar, (2) aviso de "saliste mas de 15 s" debe ser un popup que no deforme el Dashboard, (3) destello/reflujo del lector al cambiar de capitulo, (4) al reabrir el EPUB aterriza 1 a 2 paginas antes y el porcentaje retrocede.

Fuera de alcance v2 (siguen como limitaciones conocidas): codigo de recuperacion = profile_id, restore sin pagina/CFI, cierre anticipado del chat.

## 2. Cambios al SRS / CLAUDE.md que esto implica (requieren aprobacion)

- Navegacion: de tres items a dos. Actualizar la regla de CLAUDE.md seccion 5 y SRS donde corresponda.
- Racha: se oculta en la interfaz mediante una bandera de funcionalidad (por ejemplo `FEATURES.streak = false` en un unico lugar). No se borra `streak_engine.py`, ni sus tests, ni campos, ni migraciones. Los tests existentes siguen pasando.
- Estadisticas: se oculta de la navegacion y se conserva el codigo existente; no se borran archivos (CLAUDE.md prohibe borrar sin aprobacion).
- SRS 10.8 (lector): ahora especifica texto justificado. Ya editado.

## 3. Pantallas (ver PNG)

| Archivo | Contenido |
|---|---|
| `01_elegir_modo.png` | Opciones Temporizador / Libre como tarjetas. Referencia historica: en el diseno final esta eleccion es el selector compacto del Dashboard (07). |
| `02_lector_interfaz_visible.png` | Lector con cronometro, porcentaje, botones de tamano de letra y ocultar interfaz, y barra inferior prev/sig + "Terminar sesion". |
| `03_interfaz_oculta.png` | Texto a pantalla completa, linea de progreso de 2 px (sage) y boton flotante "..." que abre el menu. |
| `04_menu_flotante.png` | Menu con 5 acciones. "Hablar con Komi" lleva el icono con fondo accent. Veladura sobre el texto. |
| `05_fin_sesion.png` | Hoja inferior: "Sesion terminada", tiempo (tabular-nums 48/56), barra del avance del libro, CTA para charlar con Komi y salida "Por hoy no, volver al jardin". |
| `06_animacion_pasar_pagina.png` | Storyboard 0 / 160 / 320 ms. |
| `07_dashboard.png` | Dashboard sin racha. Izquierda: modo Temporizador. Derecha: modo Libre. |

## 4. Reglas por componente

### Lector
- Zonas de toque: tercio izquierdo = pagina anterior, central = abrir menu, derecho = pagina siguiente. Tambien arrastre horizontal.
- Interfaz oculta: solo texto + linea de progreso de 2 px + boton flotante. El menu se abre con ese boton o con el tercio central.
- Tamano de letra: rango 16 a 22 px (SRS 10.8). Cambiarlo no debe perder la posicion (usar CFI).
- Modo noche/dia desde el menu cambia el tema del lector; por confirmar si cambia el tema global de la app o solo el lector.
- "Hablar con Komi" en el menu = terminar la sesion y abrir el chat (mismo flujo que "Sesion terminada"). Por confirmar si pide confirmacion antes de cerrar la sesion.

### Modo libre
- Cronometro calculado con `Date.now()` contra la hora de inicio (nunca contando ticks), igual que el temporizador.
- Mismo periodo de gracia de 15 s con Page Visibility.
- Duracion minima propuesta: 5 minutos (pendiente de OK final). Motivo: no es por la racha; es por el filtro que el servidor ya aplica (sesiones de 5 a 120 min), para no registrar toques accidentales, no otorgar el bono solar ni gastar la cuota diaria de Gemini en sesiones de segundos. Una sesion libre de menos de 5 min no se guarda y se avisa al usuario.
- Por confirmar: tope maximo si se deja corriendo (propuesta 120 min, igual que el servidor), si aplica a libro fisico ademas de EPUB, y como se valida en el servidor la regla "<50 % programado" cuando no hay tiempo programado (propuesta: no aplica en modo libre).

### Libro fisico: sonido al terminar el tiempo
- Al llegar a 0 en el temporizador de un libro fisico, suena una senal corta y suave.
- Safari iOS bloquea audio sin gesto del usuario: crear/reanudar el audio (AudioContext o elemento audio) dentro del toque de "Comenzar lectura" y reutilizarlo despues.
- La pantalla ya permanece encendida durante la sesion (funciona en v1); no hay trabajo nuevo ahi. El sonido solo es fiable con la app en primer plano.
- Silencio del iPhone: en iOS no existe una forma fiable de detectar el interruptor de silencio desde la web. En su lugar, evitar el problema: configurar `navigator.audioSession.type = 'playback'` (Audio Session API de Safari) antes de reproducir, para que suene aunque el telefono este en silencio. Probar en el iPhone real. Si no funciona, mostrar un aviso breve en la pantalla de fin de tiempo ("El tiempo termino") como respaldo visual. `navigator.vibrate` no existe en iOS; no depender de el.
- Asset de sonido: archivo propio pequeno, empaquetado en el precache de Workbox para que funcione offline. Sin dependencias nuevas.
- Por confirmar: opcion en Ajustes para desactivarlo.

### Dashboard
- Cabecera: "Komi" (Lora 22/28) a la izquierda y boton de ajustes a la derecha. Sin racha.
- Girasol central en halo de 220 px (sin cambios respecto al prototipo), titulo del libro (Lora 20/28), autor y formato, barra de progreso sage de 160 x 6 y "N % leido".
- Selector Temporizador | Libre: control segmentado en pastilla (fondo surface, segmento activo en elevated, 36 px de alto). Recuerda la ultima eleccion.
- Temporizador: `[-] 15:00 [+]` (botones de 44 px, numero 48/56 tabular-nums). Libre: texto breve "Sin limite de tiempo. El cronometro empieza al abrir el lector." con icono de infinito.
- CTA "Comenzar lectura" 56 px, fondo accent.
- Maximo 4 bloques funcionales y al menos 40 % de espacio en blanco (verificado en el diseno).

### Animacion de pasar pagina
- 320 ms, `ease-out`, solo `transform` y `opacity` (GPU).
- La pagina actual sale a la izquierda (opacidad baja a 0.6), la nueva entra desde la derecha; hacia atras, en sentido contrario.
- Con `prefers-reduced-motion`, cambio instantaneo.
- El progreso se guarda al terminar el movimiento.

## 5. Tokens usados (SRS 9.2 y 9.5, sin cambios)

| Token | Claro | Oscuro |
|---|---|---|
| bg | #F7F5F0 | #181A18 |
| surface | #EAE6DF | #232623 |
| elevated | #FDFCFA | #2C302C |
| accent | #E5A93C | #EBB85B |
| sage | #6B8E78 | #82A890 |
| text | #2C302E | #ECE8DF |
| border | #DCD6CC | #363A36 |
| halo (prototipo) | #FAF8F5 | #1E211E |

Nota de contraste: `text-secondary` (#7A7267) sobre bg da 4.34:1 y no llega a AA para texto pequeno; en los mockups el texto pequeno usa `text`. Confirmar si se ajusta el token (requiere aprobacion) o se usa `text` en texto pequeno.

Los PNG tienen un fondo beige de lienzo y un marco de telefono solo para presentacion; no son parte de la UI. El texto de ejemplo del lector (Elena) es de relleno.

## 6. Orden sugerido (un bloque por vez, plan corto antes de cada uno)

1. Rama `v2` separada de `main` (main despliega solo a produccion en Render y Pages).
2. Ocultar racha y Estadisticas (bandera de funcionalidad) + navegacion de 2 items.
3. Margenes/tipografia del lector y los 4 pendientes Android.
4. Interfaz oculta + menu flotante + animacion de pagina.
5. Modo libre (con las reglas por confirmar resueltas) + selector en el Dashboard.
6. Sonido de fin de tiempo en libro fisico.
7. Pruebas en iPhone real antes de fusionar a `main`.
