// One job is checked and deployed by one start at a time — its *gate*
// (convention §7.5). A start that finds the gate held waits for it and then
// checks afresh, so two starts never deploy over each other, and the second
// one sees what the first deployed. A deploy holds the gate until its runs
// are launched.

/** Lets a gate go. Releasing twice is harmless, so every path may. */
export type Release = () => void

/** Every job's gate, by folder. */
export class JobGates {
  /** Each job's gate: the last holder's turn, which the next one waits out. */
  private readonly gates = new Map<string, Promise<void>>()

  /**
   * Waits for the job's gate and holds it. Whoever holds it is the only
   * start checking or deploying that job; the answer lets it go.
   */
  async acquire(path: string): Promise<Release> {
    const before = this.gates.get(path) ?? Promise.resolve()
    let open!: () => void
    const turn = new Promise<void>((resolve) => {
      open = resolve
    })
    const tail = before.then(() => turn)
    this.gates.set(path, tail)
    await before
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      open()
      if (this.gates.get(path) === tail) {
        this.gates.delete(path)
      }
    }
  }
}
