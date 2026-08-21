// The Express surface: every route §43.2 answers, wired to the answers the
// sibling files compute. Routing, decoding, the body cap, and framing are
// the library's; what is coco's here is only which places exist and who
// answers for them.

import express from 'express'
import type { AgentDeps, AgentResponse } from './answer'
import { failure } from './answer'
import { help } from './help'
import { bench_detail, job_detail, list_entities } from './reads'
import { start_run } from './start'

/**
 * The most a request body may be. A start's parameters are a handful of short
 * strings; anything at this size is a mistake or an attack, and reading it
 * into memory to find out is the mistake's accomplice.
 */
const MAX_BODY = 64 * 1024

/** Writes a finished answer; `send` on a string frames it with its length. */
function reply(response: express.Response, answer: AgentResponse): void {
  response.status(answer.status).type('application/json').send(answer.body)
}

/** The body as `start_run` reads it: text when one arrived, empty when not. */
function text_of(body: unknown): string {
  return typeof body === 'string' ? body : ''
}

/** The routes. Kept in one place so the whole surface is readable at once. */
export function agent_app(deps: AgentDeps): express.Express {
  const app = express()
  // Two headers the wire does not need: the advert, and cache validators on
  // replies nothing ever caches.
  app.disable('x-powered-by')
  app.disable('etag')

  // The body arrives as text: neither the MCP binary nor a bare `curl -d`
  // promises a Content-Type, and the JSON parse belongs to `start_run`,
  // whose 400 carries the parse error's own sentence. The 64 KiB cap is
  // enforced here — on the declared length first.
  app.use(express.text({ type: () => true, limit: MAX_BODY }))

  app.get('/help', (_request, response) => reply(response, help()))
  app.get('/jobs', (_request, response) =>
    reply(response, list_entities(deps.current_world(), 'Job'))
  )
  app.get('/benches', (_request, response) =>
    reply(response, list_entities(deps.current_world(), 'Bench'))
  )
  app.get('/jobs/:name', (request, response) =>
    reply(response, job_detail(deps.current_world(), request.params.name))
  )
  app.get('/benches/:name', (request, response) =>
    reply(response, bench_detail(deps.current_world(), request.params.name))
  )
  app.post('/experiments/:name/runs', async (request, response) =>
    reply(response, await start_run(request.params.name, text_of(request.body), deps))
  )

  // A place spoken to with the wrong verb, then everything that is no place.
  const surface = [
    '/help',
    '/jobs',
    '/benches',
    '/jobs/:name',
    '/benches/:name',
    '/experiments/:name/runs'
  ]
  app.all(surface, (_request, response) => reply(response, failure(405, 'unsupported method')))
  app.use((_request, response) => reply(response, failure(404, 'no such endpoint')))

  // What the body layer refuses arrives as an error carrying its status —
  // the cap's 413, an aborted read's 400.
  const on_error: express.ErrorRequestHandler = (error, _request, response, _next) => {
    const status = error instanceof Error && 'status' in error ? Number(error.status) : 400
    const message = error instanceof Error ? error.message : String(error)
    reply(response, failure(Number.isFinite(status) ? status : 400, message))
  }
  app.use(on_error)
  return app
}
