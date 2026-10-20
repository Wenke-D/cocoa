// What colours a run's status, or a piece of news: the one reading the status
// dot and the journal both draw in (§23).

import type { RunStatus } from '@shared/world'

/** What something means, which is what colours it: good news, bad, a warning, or just news. */
export type Tone = 'neutral' | 'info' | 'good' | 'bad' | 'warn'

/** A status's tone: everything still under way is news, `Cancelling` included. */
export function tone_of(status: RunStatus): Tone {
  if (status === 'Succeeded') {
    return 'good'
  }
  if (status === 'Failed' || status === 'Error') {
    return 'bad'
  }
  if (status === 'Cancelled') {
    return 'neutral'
  }
  return 'info'
}

/** The colour a tone is drawn in. */
export function tone_color(tone: Tone): string {
  switch (tone) {
    case 'good':
      return 'var(--chart-green)'
    case 'bad':
      return 'var(--chart-red)'
    case 'warn':
      return 'var(--chart-yellow)'
    case 'neutral':
      return 'var(--chart-gray)'
    case 'info':
      return 'var(--chart-blue)'
  }
}
