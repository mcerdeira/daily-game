# Gol · Puzle diario de fútbol

Juego web de un puzle por día: llevar la pelota al arco pasando por todos los compañeros sin pisar dos veces la misma casilla.

- Publicado en https://mcerdeira.github.io/daily-game/ (GitHub Pages, repo `mcerdeira/daily-game`, rama `main`).
- Todo el juego vive en `index.html`: HTML, CSS y JS inline, sin dependencias, sin build, sin tests.
- `og.png` (1200×630) es la imagen de preview de link. Es estática, no hay script que la genere.

## Cómo probar

- Abrir `index.html` en el navegador, o `python3 -m http.server` y entrar a `localhost:8000`.
- `?d=YYYY-MM-DD` fuerza la fecha (puzle, número y dificultad de ese día). Usa las mismas claves de `localStorage` que ese día real.
- Para repetir el puzle del día hay que borrar `gol1:<fecha>` de `localStorage`.

## Convenciones

- Textos de la interfaz en español rioplatense con voseo ("Llevá", "Tocá", "Arrastrá").
- Comentarios e identificadores del código en inglés.
- Mensajes de commit en español, cortos y en minúscula.
- Ancho máximo 440px, pensado primero para celular. Respetar `env(safe-area-inset-*)`.

## Vocabulario: código ↔ juego

| Código | En el juego |
|---|---|
| `S` | Casilla de salida (círculo blanco) |
| `E` | Arco |
| `stations` | Compañeros (camiseta azul) |
| `blocked` / `rocks` | Conos y rivales. Son lo mismo; cuál se dibuja sale de `(c + S + E) % 2` y es solo estético |
| `path` | Recorrido de la pelota, lista de índices de casilla |
| `cross` | Cruces: visitas repetidas a una casilla |
| `P` | Puzle activo (el diario o uno de práctica) |

Tablero de `N = 5`, casillas indexadas `0..24` por filas (`fila * N + columna`). El SVG usa `viewBox="0 0 500 500"`, 100 unidades por casilla.

## Reglas

- Movimiento ortogonal a casillas vecinas. No se entra a casillas bloqueadas.
- Puntaje: `max(0, 100 − 25 × compañeros que faltan − 10 × cruces)`. Está en `calc()` y también escrito en el modal de ayuda: cambiar los dos.
- Se patea llevando la pelota al arco: arrastrándola hasta ahí, tocando el arco desde una casilla vecina o con las flechas. No hay un toque extra para patear.
- Arrastrar solo patea si el dedo está sobre el arco (`t === P.E` en `stepToward`). Si el arrastre apunta a una casilla más allá y el arco queda en el medio, se frena antes sin patear.
- Patear con 100 puntos termina directo. Con menos, pide confirmación (`pending`): "Seguir" saca el arco del recorrido, "Rematar" finaliza. Esa confirmación es la única protección contra un arrastre accidental al arco: no sacarla.
- Rematar es definitivo: un solo resultado por día.
- "Borrar" reinicia el recorrido y suma un intento (`resets`); el intento se muestra al compartir.
- Con menos de 100 aparece "Ver la solución", que alterna entre la jugada del usuario y una perfecta (`findPerfect`).

## Generación de puzles

`generateWith(seed, level, extraRocks)` prueba hasta 12000 tableros al azar y devuelve el primero que cumple:

1. Distancia Manhattan entre `S` y `E` de al menos 3.
2. Entre 1 y `maxSol` recorridos perfectos (`countPerfect`, con tope de 60000 nodos).
3. Tentación: el camino más corto permitiendo repetir casillas (`shortestWalk`) es más corto que el perfecto más corto.
4. `effort >= minEffort`. `effort` simula a alguien que siempre va al compañero pendiente más cercano y cuenta los nodos que recorre hasta dar con la jugada perfecta (tope 3000).

Si ninguno llega a `minEffort`, devuelve el de mayor `effort` entre los que cumplen 1 a 3. Si no hay ninguno, reintenta con seed `+ '+'` y un cono más.

`DIFF` se indexa por día de la semana (`0` = domingo):

| Día | Nivel | Compañeros | Bloqueos | `maxSol` | `minEffort` |
|---|---|---|---|---|---|
| Dom (0) | Experto | 4 | 2 | 1 | 1000 |
| Lun (1) | Fácil | 3 | 4 | 2 | 100 |
| Mar (2) | Fácil | 4 | 3–4 | 2 | 150 |
| Mié (3) | Media | 4 | 3 | 2 | 300 |
| Jue (4) | Media | 4 | 2–3 | 1 | 500 |
| Vie (5) | Difícil | 4 | 2–3 | 1 | 700 |
| Sáb (6) | Difícil | 4 | 2 | 1 | 700 |

Los botones de práctica usan esos mismos índices vía `data-lvl`: Fácil `1`, Media `3`, Difícil `5`, Experto `0`. La práctica usa una seed aleatoria, no guarda progreso ni toca las estadísticas.

La generación corre sincrónica al cargar la página. Si se suben los topes o la dificultad, medir el tiempo de carga en celular.

### Determinismo (importante)

El puzle del día sale de la seed `'gol-v1-' + dateKey` con `hashStr` + `mulberry32`. Todos los jugadores tienen que ver el mismo tablero, así que cualquier cambio en lo siguiente cambia los puzles de todas las fechas:

- `DIFF`, los filtros de `generateWith` o el orden en que se consume el `rng`.
- `hashStr`, `mulberry32`, `countPerfect`, `shortestWalk`, `effort`.
- El prefijo de la seed.

Un cambio así a mitad del día le cambia el tablero a quien ya jugó: el progreso guardado se descarta si no encaja con el tablero nuevo, o queda un resultado que no corresponde. Hacerlo a propósito y avisarle al usuario antes.

## Fecha y numeración

- La fecha es la local del dispositivo, no UTC. El puzle cambia a la medianoche local.
- `dayNumber`: el Nº 1 es el 30 de septiembre de 2026 (`Date.UTC(2026, 8, 30)`). No mover esa fecha.

## Persistencia (`localStorage`)

| Clave | Contenido |
|---|---|
| `gol1:YYYY-MM-DD` | `{ path, resets, done }` del puzle de ese día |
| `gol1:stats` | `{ played, perfect, streak, last }` |
| `gol1:seen` | `1` cuando ya se cerró la ayuda una vez |

- Todo acceso pasa por `store`, que traga los errores: el juego tiene que funcionar sin `localStorage`.
- Al cargar, `applyPuzzle` valida el `path` guardado contra el tablero actual y lo descarta si no encaja.
- Si cambia el formato guardado, cambiar el prefijo `gol1:` (se pierden rachas) o migrar.

## Compartir

`shareText` arma:

```
Gol #<n> ⚽ <dificultad>
🟩🟩🟩🟥  Sin cruces ✨
Puntaje <p>/100 · intento <k>
<SITE_URL>
```

- En celular usa `navigator.share`; en escritorio copia al portapapeles, con `execCommand('copy')` como respaldo.
- El texto no revela el recorrido. Mantenerlo así.

## Cosas duplicadas que hay que cambiar juntas

- **URL del sitio**: `SITE_URL` en el JS, `canonical`, `og:url`, `og:image`, `twitter:image`.
- **Descripción**: `meta description`, `og:description`, `twitter:description` y el primer párrafo del modal de ayuda.
- **Colores**: los tokens de modo oscuro están dos veces, en `@media (prefers-color-scheme:dark)` y en `:root[data-theme="dark"]`.
- **Pelota**: `ball()` en el JS, el favicon (SVG inline en el `<link rel="icon">`, misma pelota con radio 14) y `og.png`.
- **Aspecto del tablero**: si cambian las piezas o los colores de la cancha, `og.png` queda desactualizada y hay que rehacerla a mano (1200×630).

## Dibujo

- `render()` reconstruye todo el SVG con `innerHTML` en cada cambio de estado y actualiza el HUD. No hay DOM persistente dentro del tablero, así que una animación dentro del tablero se reinicia en cada `render()`.
- Cada pieza es una función que devuelve un string SVG para una casilla de 100×100: `fig`, `cone`, `mate`, `ball`, `goalIcon`, `spot`. El modal de ayuda reutiliza esas mismas funciones vía `data-ic`.
- Usar las variables CSS (`--pitch1`, `--mate`, `--rival`, `--good`, `--bad`...) para que funcionen los dos temas.

## Festejo del gol

Se dispara en `finalize()`, o sea en cada remate definitivo (con cualquier puntaje, diario o práctica). No se repite al recargar un puzle ya terminado.

- **Papelitos y grito**: `celebrate()` agrega a `<body>` una capa `#cheer` (`position:fixed`, `pointer-events:none`, `aria-hidden`) con un `<canvas>` de papelitos y la palabra `GOOOOOOOOL!`, una `<span>` por letra con `--i` para escalonar las animaciones `cheer-pop` y `cheer-bob`. La capa se elimina sola a los 3,6 s (`LIFE`).
- **Arco**: la variable `kick` queda en `true` por 900 ms después del remate; mientras tanto `render()` envuelve el arco y la pelota en `<g class="kick">`, que tiene la animación CSS `kick`.
- El festejo no bloquea la interfaz ni cambia el estado del juego: es solo visual.
- Con `prefers-reduced-motion: reduce` no hay papelitos ni movimiento: solo aparece la palabra y se desvanece.

## Entrada

- Pointer events sobre el SVG: arrastrar desde la pelota (incluso hasta el arco para patear), tocar una casilla vecina, o tocar un tramo anterior para cortar el recorrido hasta ahí.
- Volver a la casilla anterior deshace el último paso.
- Flechas del teclado con el tablero enfocado.
- Mantener `touch-action:none` en el tablero para que arrastrar no haga scroll.
