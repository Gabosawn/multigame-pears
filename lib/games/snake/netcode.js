// Netcode: prediccion local con rollback.
//
// La idea, que es la de los juegos de pelea: por la red no viaja estado, viajan
// inputs sellados con el numero de tick ABSOLUTO en que hay que aplicarlos.
// Como la simulacion es deterministica, dos maquinas que aplican los mismos
// inputs en los mismos ticks llegan al mismo estado — sin importar en que orden
// llegaron los paquetes.
//
// Tu propio input se aplica en el tick actual, sin esperar a nadie: tu
// serpiente responde con cero latencia. El rival lo recibe uno o dos ticks mas
// tarde, rebobina al tick sellado y re-simula. Como el estado de snake son dos
// arrays de numeros, re-simular veinte ticks son microsegundos.
//
// La alternativa clasica es meter input delay (aplicar todo en tick+D para que
// nadie tenga que rebobinar). Es mas simple, pero le agrega D ticks de retardo
// a TU propio movimiento, que es exactamente lo que se siente como lag.
//
// El tick no sale de contar cuantas veces corrio el setInterval sino del reloj:
// tick = (ahora - arranque) / TICK_MS. Asi un frame que se atrasa no desfasa la
// partida para siempre, se recupera en el siguiente.

// Cuanto podemos rebobinar. Un paquete que llega mas tarde que esto no se puede
// reconciliar y hay que resincronizar con un snapshot completo.
const HISTORY = 120

module.exports = class Netcode {
  constructor(sim, { player }) {
    this.sim = sim
    this.player = player // 0 o 1: cual de las dos serpientes soy
    this.state = sim.state
    this.inputs = new Map() // tick -> [dir0, dir1]
    this.snapshots = new Map() // tick -> estado al INICIO de ese tick
    this.rollbacks = 0 // para mostrarlo en la UI: es un dato, no un secreto
    this.desyncs = 0

    this.snapshots.set(this.state.tick, sim.clone(this.state))
  }

  get tick() {
    return this.state.tick
  }

  _record(tick, player, dir) {
    let slot = this.inputs.get(tick)
    if (slot === undefined) {
      slot = [null, null]
      this.inputs.set(tick, slot)
    }
    slot[player] = dir
  }

  _step() {
    const pending = this.inputs.get(this.state.tick)
    if (pending !== undefined) {
      if (pending[0] !== null) this.sim.setDir(this.state, 0, pending[0])
      if (pending[1] !== null) this.sim.setDir(this.state, 1, pending[1])
    }
    this.sim.step(this.state)
    this.snapshots.set(this.state.tick, this.sim.clone(this.state))
  }

  // avanza hasta el tick pedido; el loop lo llama con el tick derivado del reloj
  advanceTo(target) {
    // un salto enorme (la maquina se suspendio, la terminal quedo sin foco) no
    // se re-simula tick por tick: se salta y se resincroniza
    if (target - this.state.tick > HISTORY) {
      this.state.tick = target
      this._prune()
      return this.state
    }
    while (this.state.tick < target) this._step()
    this._prune()
    return this.state
  }

  // Mi input, aplicado ya. Devuelve lo que hay que mandarle al rival.
  //
  // Un input por tick y por jugador, y los de mas se encolan al tick siguiente.
  // Esto no es un detalle: si dos teclas del mismo tick se aplicaran en
  // secuencia localmente, el mapa de inputs guardaria solo la ultima y el
  // replay partiria de otra direccion base. Ejemplo real: vas a la derecha,
  // apretas abajo y despues izquierda en el mismo tick. Local: derecha→abajo
  // (ok) →izquierda (ok, no es 180 respecto de abajo). Replay: derecha→
  // izquierda, que SI es 180 y se rechaza. Las dos maquinas quedan con
  // direcciones distintas y la partida se separa en silencio.
  //
  // La validacion de giro vive dentro de setDir, que corre igual en las dos
  // puntas durante el replay. Mientras haya un solo input por tick, local y
  // replay son identicos por construccion.
  localInput(dir) {
    const snake = this.state.snakes[this.player]
    if (!snake.alive) return null

    const taken = (t) => {
      const slot = this.inputs.get(t)
      return slot !== undefined && slot[this.player] !== null
    }

    let tick = this.state.tick
    while (taken(tick)) tick += 1

    // tecleo mas rapido que el tick rate: los de mas se descartan
    if (tick > this.state.tick + 3) return null

    // ya vamos para ese lado: no gastar un paquete
    if (tick === this.state.tick && snake.dir === dir) return null

    this._record(tick, this.player, dir)
    if (tick === this.state.tick) this.sim.setDir(this.state, this.player, dir)
    return { tick, dir }
  }

  // input del rival. Si viene sellado en el pasado, rebobinamos y re-simulamos.
  remoteInput(tick, dir) {
    const other = this.player === 0 ? 1 : 0

    if (tick > this.state.tick + HISTORY) return false // absurdo: descartar

    this._record(tick, other, dir)

    if (tick >= this.state.tick) {
      // llego con tiempo: lo consume el loop cuando alcance ese tick
      return true
    }

    const snapshot = this.snapshots.get(tick)
    if (snapshot === undefined) return false // demasiado viejo: lo arregla el sync

    const target = this.state.tick
    this.state = this.sim.clone(snapshot)
    this.sim.state = this.state
    while (this.state.tick < target) this._step()
    this.rollbacks += 1
    return true
  }

  hash() {
    return this.sim.hash(this.state)
  }

  // Hash de un tick pasado, para comparar contra el que manda el rival: su tick
  // 90 y nuestro tick 90 son el mismo instante de la partida aunque sus relojes
  // no coincidan.
  hashAt(tick) {
    const snapshot = this.snapshots.get(tick)
    if (snapshot === undefined) return null
    return this.sim.hash(snapshot)
  }

  serialize() {
    return {
      tick: this.state.tick,
      rng: this.state.rng,
      food: this.state.food,
      snakes: this.state.snakes.map((s) => ({
        body: s.body.slice(),
        dir: s.dir,
        alive: s.alive,
        grow: s.grow
      })),
      dead: this.state.dead
    }
  }

  // adoptar el estado del peer con autoridad tras detectar una desincronizacion
  adopt(snapshot) {
    this.state = {
      tick: snapshot.tick,
      rng: snapshot.rng >>> 0,
      food: snapshot.food,
      snakes: snapshot.snakes.map((s) => ({
        body: s.body.slice(),
        dir: s.dir,
        alive: s.alive,
        grow: s.grow
      })),
      dead: snapshot.dead || null
    }
    this.sim.state = this.state
    this.snapshots.clear()
    this.snapshots.set(this.state.tick, this.sim.clone(this.state))
    // los inputs viejos ya estan cocinados dentro del snapshot; volver a
    // aplicarlos moveria la partida dos veces
    for (const tick of this.inputs.keys()) {
      if (tick < this.state.tick) this.inputs.delete(tick)
    }
    this.desyncs += 1
  }

  _prune() {
    const floor = this.state.tick - HISTORY
    if (floor <= 0) return
    for (const tick of this.snapshots.keys()) if (tick < floor) this.snapshots.delete(tick)
    for (const tick of this.inputs.keys()) if (tick < floor) this.inputs.delete(tick)
  }
}
