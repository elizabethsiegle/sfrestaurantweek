import type { Env } from '../../worker/index.js'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
