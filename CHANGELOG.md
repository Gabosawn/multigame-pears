## v0.1.0

### Features

- Plataforma de juegos P2P para la terminal, sobre Pear y Bare
- Lobby con descubrimiento por Hyperswarm
- 3 en raya

---

## v0.2.0

### Features

- Salas con nombre: quien escribe el mismo nombre juega con vos
- Revancha

### Improvements

- Busqueda agresiva de rival mientras no hay con quien jugar

---

## v0.3.0

### Features

- Descubrimiento de rival por Bluetooth LE, sin internet
- Puente BlueZ para ble-swarm en Linux, que upstream no tiene

### Improvements

- Lobby resistente a conexiones duplicadas y cortes de socket
- Bluetooth le gana a internet: nunca se degrada la conexion

---

## v0.4.0

### Features

- Snake 1v1 en tiempo real, con prediccion local y rollback
- Chat P2P durante la partida, con [t]
- Canal de contenido: arenas firmadas que llegan de peer a peer, tambien por
  Bluetooth, sin bajar el binario
- Pantalla de novedades cuando un OTA aterriza
- Flechas y WASD (antes las secuencias de escape se descartaban)

### Improvements

- Renderer diferencial: se reescriben solo las lineas que cambian, no la
  pantalla entera. Buena parte de la sensacion de lag era parpadeo
- Snake manda inputs de 4 bytes en vez de estado en JSON: ~5 mensajes por
  segundo en vez de uno por evento
- Cada copia instalada anuncia el drive: los jugadores son seeders
- Transporte, RTT medido y contador de rollbacks a la vista en la barra
- Cuenta regresiva visible en la ventana de reconexion
- MTU real sobre BLE: BlueZ lo publica de forma asincrona y se reintenta hasta
  que aparece, ~500 bytes por chunk en vez de 150
- setOnline(true) cuando el anuncio en la DHT sale, para que BLE deje de
  reescanear cada 5s durante toda la partida

### Fixes

- La arena que viaja en MATCH perdía las paredes al reconstruirse: el invitado
  jugaba "El muro" sin muro y la partida se separaba sola
- Los inputs de snake en vuelo se perdían cuando hyperswarm deduplicaba los
  sockets cruzados a mitad de partida (~6s después de emparejar): ahora se
  reenvían tras el swap y el netcode ignora los repetidos
- Dos teclas en el mismo tick desincronizaban la partida en silencio
- El evento updating-delta se enganchaba pero nadie lo emitia: el OTA no
  mostraba progreso
- El README anunciaba un juego que no existia

---

## v0.4.1

### Fixes

- Un check fallido de libdbus abortaba el juego entero en plena búsqueda de
  rival (SIGABRT); ahora el BLE de esa sesión se degrada y la partida por
  internet sigue viva
- El backend BLE registraba y desregistraba la app GATT dos veces por arranque;
  esa ventana de mutación producía el path inválido del abort y llegó a tumbar
  a bluetoothd entero. El registro ahora es idempotente
- BlueZ puede soltar un anuncio ya aceptado (Release) y nadie lo escuchaba: el
  lobby quedaba invisible para siempre creyendo que anunciaba. Ahora se
  re-anuncia con backoff

---

## v0.4.2

### Fixes

- Cualquier dispositivo Bluetooth del vecindario que cambiara su estado de
  conexión podía matar el juego entero: el puente emitía un error que nadie
  escuchaba y la excepción tumbaba el proceso. El duelo por BT "se conectaba y
  desconectaba" porque una de las puntas literalmente se moría
- La interfaz se congelaba a saltos de 2 segundos mientras una conexión BT
  enganchaba: el binding de Linux hace llamadas D-Bus síncronas en el loop
  principal. Va vendorizado con el timeout bajado a 300ms (hipos en vez de
  freezes) hasta que upstream sea asíncrono

### Improvements

- Flag --no-bluetooth: buscar rival solo por internet, para jugar estable
  mientras el BLE de Linux madura
