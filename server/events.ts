import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { DatasetEvent } from '@core/api-types'

type Listener = (event: DatasetEvent) => void

const HEARTBEAT_MS = 25_000

export class EventBroadcaster {
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  broadcast(event: DatasetEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  /** GET /api/events. The heartbeat comment keeps proxies and idle-timeouts from closing a quiet connection. */
  stream(c: Context): Response {
    return streamSSE(c, async (stream) => {
      const unsubscribe = this.subscribe((event) => {
        void stream.writeSSE({ event: 'dataset', data: JSON.stringify(event) })
      })
      const heartbeat = setInterval(() => void stream.write(': heartbeat\n\n'), HEARTBEAT_MS)
      // Flush headers immediately so EventSource reports "open" before the first event.
      await stream.write(': connected\n\n')
      await new Promise<void>((resolve) => stream.onAbort(resolve))
      clearInterval(heartbeat)
      unsubscribe()
    })
  }
}
