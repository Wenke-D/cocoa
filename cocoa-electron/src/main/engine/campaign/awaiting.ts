// Campaign runs whose own report is to be regenerated once their members'
// have landed (convention §8.3). Held in memory only: a close forgets the
// wait, leaving the members that landed regenerated and the campaign's own
// report as it was.

export class AwaitingMembers {
  /** Run ids, by campaign folder. */
  private readonly runs = new Map<string, Set<number>>()

  add(folder: string, run_id: number): void {
    const ids = this.runs.get(folder) ?? new Set<number>()
    ids.add(run_id)
    this.runs.set(folder, ids)
  }

  has(folder: string, run_id: number): boolean {
    return this.runs.get(folder)?.has(run_id) ?? false
  }

  delete(folder: string, run_id: number): void {
    const ids = this.runs.get(folder)
    ids?.delete(run_id)
    if (ids?.size === 0) {
      this.runs.delete(folder)
    }
  }

  /** Every campaign run waiting, as `[folder, run_id]`. */
  all(): [string, number][] {
    return [...this.runs].flatMap(([folder, ids]) =>
      [...ids].map((run_id): [string, number] => [folder, run_id])
    )
  }
}
