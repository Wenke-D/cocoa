/** The message of a rejected promise; fails loudly if it resolves. */
export async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected a failure, but the operation succeeded')
}

/** The message of a thrown call; fails loudly if it returns. */
export function throws(call: () => unknown): string {
  try {
    call()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected a failure, but the call returned')
}
