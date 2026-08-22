# multigame-pears

> Un arcade peer-to-peer para la terminal, sobre [Pear] y [Bare]. Se instala sin app store y se
> actualiza atravesando la sala.

Dos personas en la misma sala se encuentran y juegan **sin servidor de matchmaking, sin cuenta y
sin infraestructura**. El lobby busca rivales por [Hyperswarm] y por Bluetooth LE al mismo tiempo:
apagá el wifi y la partida sigue.

## Instalación

Con el [Pear CLI](https://install.pears.com):

```sh
pear install pear://h1h8okbqt6r3hdgpfrta9mkw69ty1ukiu7brin1juydwgakn9efy
```

Sin el Pear CLI, vía `npx`:

```sh
npx pear-install pear://h1h8okbqt6r3hdgpfrta9mkw69ty1ukiu7brin1juydwgakn9efy
```

Después, simplemente:

```sh
multigame-pears
```

Necesita una terminal interactiva de al menos **80x24**.

## Juegos

| Juego         | Modo        | Controles           |
| ------------- | ----------- | ------------------- |
| **3 en raya** | por turnos  | teclas `1`-`9`      |
| **Snake**     | tiempo real | flechas o `W A S D` |

Y **chat** con `[t]` en cualquier momento, durante la partida.

## Los dos niveles de actualización

Esta es la parte interesante del proyecto, y conviene no confundir los dos niveles.

### 1. La app se actualiza por OTA de Pear

`pear stage` publica una versión nueva y las copias instaladas la bajan de otros peers. El binario
se reemplaza solo; nadie descarga nada a mano.

Un detalle que medimos y que vale la pena contar: **el OTA transfiere el binario completo, ~98 MB.**
El JS de la app va bakeado dentro del ejecutable standalone, así que un cambio de solo-JS produce un
binario que difiere en apenas **4.698 bytes de 98 MB** (6 de 1509 bloques de 64 KB) — pero
[`pear-runtime-updater`][updater] usa `drive.mirror`, que compara por archivo y no por bloque, así
que baja el archivo entero. Por internet eso son unos cuatro segundos. Por Bluetooth serían horas.

Además, cada copia instalada **anuncia** el drive, no solo lo consume (`server: true` en
[`workers/main.js`](workers/main.js)): los jugadores son seeders y la sala se re-siembra a sí misma.

> **Si publicás una versión, mantené `pear seed pear://<key>` corriendo.** Pear no tiene CDN: los
> bytes de la actualización salen de peers. Si el único que los tiene apaga la máquina, las copias
> instaladas se quedan esperando y el OTA parece roto. Usá `npm run seed`, que además verifica el
> anuncio de verdad cada 30s. Lo ideal es una máquina siempre encendida — y para eso el ecosistema
> tiene [blind peering](https://docs.pears.com/how-to/blind-peering/), que es lo que hay que usar
> si conseguís un servidor.

### Por qué el OTA fallaba al primer intento

Dos causas concretas, las dos arregladas:

**El worker se caía.** `swarm.on('connection', ...)` no ponía un listener de `'error'` en la
conexión de replicación. Un peer que se corta a mitad de la transferencia emite `'error'` sin nadie
escuchando, y eso **tumba el worker thread**: el updater queda muerto por el resto de la sesión y la
actualización "anda al segundo intento". `lib/lobby.js` ya tenía esa guarda; el worker no.

**El seeder aparecía tarde.** Si el seeder anuncia _después_ de nuestro primer lookup, Hyperswarm
por su cuenta no vuelve a buscar hasta varios minutos más tarde. Ahora el worker insiste con backoff
(4s → 60s) mientras no tenga con quién replicar, y para en cuanto aparece alguien.

### 2. El contenido viaja por gossip, y ese sí pasa por Bluetooth

Para lo que el brief llama _"patch balance or add levels while people are still playing"_ hay un
segundo canal: registros JSON de unos cientos de bytes —arenas, notas de versión— que se propagan
de peer a peer **por la misma conexión de la partida**, sea internet o Bluetooth.

Una arena nueva aparece en el menú del rival en plena partida, sin reiniciar y sin bajar 98 MB. El
anfitrión manda la arena **entera** al anunciar cada partida, así que se puede estrenar en el acto
incluso contra alguien que no la tenía. Y lo que acaba de llegar se juega en la partida siguiente,
sin esperar a que la rotación pase por ahí.

Cada registro va **firmado** con la clave del autor, cuya pública viaja dentro del binario
([`lib/content.js`](lib/content.js)): un peer malicioso no puede inyectarte una arena. Se eligió
gossip en vez de replicar un Hypercore porque a esta escala son cuarenta líneas y funcionan sobre
cualquier transporte, sin multiplexar nada encima del protocolo del juego.

```sh
npm run content init                                       # crea la identidad del autor
npm run content -- arena laberinto "El laberinto" cuadros  # firma una arena
multigame-pears --content content-published.json           # y de ahí viaja solo
```

## Sobre la latencia

El proyecto arrancó con un problema real de sensación de lag. Resultó ser tres cosas distintas.

**El render.** Se hacía `\x1b[2J` y se redibujaba la pantalla entera en cada evento. A 12 ticks por
segundo eso es parpadeo, y el parpadeo se lee como lag aunque la red esté perfecta.
[`lib/screen.js`](lib/screen.js) compara frames y reescribe solo las líneas que cambiaron: en una
partida de Snake son dos o tres por frame en vez de veinticuatro.

**El protocolo.** Se mandaba estado en JSON por evento. Ahora Snake manda **inputs**, no estado: un
cambio de dirección son 4 bytes y se manda solo cuando cambia, o sea unos 5 mensajes por segundo. El
ancho de banda dejó de ser un tema — BLE da 226 kbps incluso con el MTU mínimo.

**El netcode.** Simulación determinista con predicción local y rollback: tu input se aplica en el
tick actual (cero latencia local) y el rival rebobina uno o dos ticks y re-simula. El tick sale del
reloj y no de contar intervalos, así que un frame atrasado se recupera en el siguiente. Cada 20
ticks se compara un hash de 4 bytes del estado; si difiere, el peer con autoridad manda un snapshot
— sin eso, un paquete perdido separa las partidas y uno ve que ganó mientras el otro ve que perdió.

La barra superior muestra el transporte, el RTT medido y la cuenta de rollbacks. Es a propósito: un
RTT de 90 ms sobre Bluetooth es física del radio, y mostrarlo lo convierte en un dato en vez de en
un misterio.

## Bluetooth LE

El lobby busca por Hyperswarm y por BLE en paralelo, y **Bluetooth le gana a internet** cuando los
dos están disponibles. Si el wifi se muere a mitad de partida, la conexión salta a BLE sin perder el
tablero.

[`ble-swarm`](https://github.com/mafintosh/ble-swarm) trae backends nativos para macOS, iOS y
Android, pero en Linux resuelve a `unsupported`.
[`lib/ble-backend-linux.js`](lib/ble-backend-linux.js) implementa esa misma superficie sobre BlueZ
vía D-Bus (`bare-bluetooth-linux`), con tres cosas que costaron encontrar:

- **BlueZ publica el MTU de forma asíncrona**, después de adquirir el notify. Consultarlo una sola
  vez casi siempre llegaba temprano, y el enlace se quedaba con chunks de 150 bytes para siempre.
  Ahora se reintenta hasta que aparece: ~500 bytes por chunk, un tercio de los round-trips de radio.
- **`setOnline(true)` cuando el anuncio en la DHT sale.** Sin esa señal ble-swarm reinicia el scan
  cada 5 segundos para siempre, un `startDiscovery`/`stopDiscovery` por D-Bus **durante toda la
  partida**, robándole radio al enlace que ya está funcionando.
- **BlueZ admite una sola app GATT y un solo advertisement por conexión D-Bus**, y sus registros no
  toleran concurrencia: toda operación pasa por una cola única.

Queda afuera L2CAP: el puente solo implementa el pipe GATT, que en ble-swarm es el camino lento (un
write en vuelo a la vez). Es la limitación más grande que sigue en pie.

## Plataformas

Binarios standalone para **linux-x64**, **linux-arm64**, **darwin-arm64**, **darwin-x64**,
**win32-x64** y **win32-arm64**. No hace falta tener Node.js, ni Bare, ni el Pear CLI: el runtime
viaja dentro del ejecutable. El backend BLE de Linux solo se compila en los targets de Linux (el
`imports` map de [package.json](package.json) lo resuelve por plataforma), así que el cross-compile
de las seis arquitecturas funciona igual.

## Variante de partida

Construido sobre [`hello-pear-bare`][hello-pear-bare], rama **`main`** — la que corre el updater de
`pear-runtime` en un worker thread de Bare. Es la forma correcta para un proceso de vida larga como
un TUI: la lógica peer-to-peer de updates no compite con el render loop del juego.

## Desarrollo

```sh
npm install
npm start                    # bare bin.mjs --no-updates
npm test                     # protocolo, teclas, determinismo y rollback de snake
npm run make                 # binario standalone en out/<platform>-<arch>
```

Los tests que importan son los de determinismo: dos simulaciones con la misma semilla y los mismos
inputs tienen que llegar al mismo hash, incluso cuando los paquetes llegan tarde y en desorden. Es
la clase de bug que arruina una partida en silencio, y se atrapa sin sockets.

## Despliegue

```sh
npm version patch            # el updater compara este campo: sin bump no hay update
npm run make                 # o los seis: npm run make:<host>
./scripts/release.sh         # arma el deployment y muestra el delta, sin publicar
./scripts/release.sh --publish
```

El script existe para que no se olviden tres cosas: el bump de versión (sin él la copia instalada
no se actualiza nunca y parece que el OTA está roto), el `--dry-run` antes de subir ~473 MB que no
se deshacen, y **copiar el `CHANGELOG.md` al deployment** — `pear build` no lo hace, y sin eso
`pear changelog pear://<key>` devuelve `No Changelog`. Ese es el mecanismo nativo de Pear para
distribuir release notes peer-to-peer, así que vale la pena que funcione:

```sh
pear changelog pear://h1h8okbqt6r3hdgpfrta9mkw69ty1ukiu7brin1juydwgakn9efy --full
```

Para las seis arquitecturas, el workflow `.github/workflows/build.yaml` compila la matriz completa
y publica un `by-arch.tar.gz` ya empaquetado, listo para `pear stage`.

### Probar el OTA sin arriesgar el link publicado

`pear touch` da un link desechable. Se fija con `npm pkg set upgrade=<link>` en una copia del
árbol, se publica ahí y se prueba el ciclo completo contra esa copia. Es como se verificó este
release: v0.4.0 instalada detectó v0.4.1 en 4 segundos, bajó los 98.9 MB, aplicó, y al reiniciar
corría el código nuevo.

## Seeding

Un link publicado no sirve de nada si su anuncio en la DHT caduca: `pear seed` sigue corriendo e
imprimiendo `announced` mientras nadie puede instalar, y del otro lado el `pear install` falla con
`ERR_NETWORK_TIMEOUT`. Por eso el seeding tiene guardián propio:

```sh
npm run seed                 # pear seed + verificación real cada 30s, con recuperación
npm run seed:check           # ¿está anunciado ahora mismo? exit 0 sí / 1 no / 2 no se pudo saber
```

El guardián consulta la DHT igual que lo haría un usuario, confirma cada caída con un segundo
chequeo antes de reiniciar nada (reiniciar cuesta ~15s con cero seeders, así que reaccionar a un
falso positivo empeora la disponibilidad), adopta un seed sano que ya esté corriendo —relevo sin
downtime— y escala a reiniciar el sidecar si reiniciar el seed no alcanza.

## Licencia

Apache-2.0

<!-- Links -->

[Pear]: https://pears.com
[Bare]: https://github.com/holepunchto/bare
[Hyperswarm]: https://github.com/holepunchto/hyperswarm
[hello-pear-bare]: https://github.com/holepunchto/hello-pear-bare
[updater]: https://github.com/holepunchto/pear-runtime-updater
