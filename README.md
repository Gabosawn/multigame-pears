# multigame-pears

> Plataforma de juegos peer-to-peer para la terminal, sobre [Pear] y [Bare].

Dos personas en la misma sala se encuentran y juegan **sin servidor de matchmaking, sin cuenta y
sin infraestructura**. El lobby descubre a los rivales por [Hyperswarm]; los juegos son módulos que
se cargan encima.

Y como la app se distribuye peer-to-peer, **un juego nuevo llega por over-the-air a la copia ya
instalada** — sin app store, sin reinstalar, sin que el usuario haga nada.

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

## Juegos

| Juego         | Modo       | Transporte                             |
| ------------- | ---------- | -------------------------------------- |
| **3 en raya** | por turnos | Hyperswarm · y BLE con el wifi apagado |

El 3 en raya es por turnos, así que sobrevive perfectamente al ancho de banda de Bluetooth LE.

## Plataformas

Binarios standalone para **linux-x64**, **linux-arm64**, **darwin-arm64**, **darwin-x64**,
**win32-x64** y **win32-arm64**. No hace falta tener Node.js, ni Bare, ni el Pear CLI: el runtime
viaja dentro del ejecutable.

## Actualizaciones over-the-air

Las actualizaciones llegan peer-to-peer desde otros usuarios que ya tienen la versión nueva. El
link publicado es el campo `upgrade` de [package.json](package.json).

Para deshabilitarlas en una corrida puntual:

```sh
multigame-pears --no-updates
```

## Variante de partida

Construido sobre [`hello-pear-bare`][hello-pear-bare], rama **`main`** — la que corre el updater de
`pear-runtime` en un worker thread de Bare. Es la forma correcta para un proceso de vida larga como
un TUI: la lógica peer-to-peer de updates no compite con el render loop del juego.

## Desarrollo

```sh
npm install
npm start                    # bare bin.mjs --no-updates
npm run make                 # binario standalone en out/<platform>-<arch>
```

## Despliegue

```sh
npm run make
pear build --package package.json --linux-x64-app out/linux-x64/multigame-pears --target deployment
pear stage pear://<key> ./deployment
pear seed pear://<key>
```

Para las seis arquitecturas, el workflow `.github/workflows/build.yaml` compila la matriz completa
y publica un `by-arch.tar.gz` ya empaquetado, listo para `pear stage`.

## Licencia

Apache-2.0

<!-- Links -->

[Pear]: https://pears.com
[Bare]: https://github.com/holepunchto/bare
[Hyperswarm]: https://github.com/holepunchto/hyperswarm
[hello-pear-bare]: https://github.com/holepunchto/hello-pear-bare
