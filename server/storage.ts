import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LlmFormat } from '@core/api-types'

export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.SALES_PULSE_DATA_DIR) return env.SALES_PULSE_DATA_DIR
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'sales-pulse')
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'sales-pulse')
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'sales-pulse')
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** Write to a temp file then rename, so a crash mid-write never leaves a half-written JSON file behind. */
export async function writeFileAtomic(file: string, data: string | Buffer, mode = 0o600): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, data, { mode })
  try {
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value))
}

/** Returns null when the file does not exist. Corrupt JSON is an error the caller decides how to handle. */
export async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

// ---------- Encrypted credentials ----------

export interface StoredLlmConfig {
  format: LlmFormat
  baseUrl: string
  model: string
  apiKey: string
}

export interface StoredTelegramConfig {
  botToken: string
  chatId: string
}

export interface Credentials {
  llm?: StoredLlmConfig
  telegram?: StoredTelegramConfig
  pushToken?: string
}

const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
}

export function decrypt(payload: Buffer, key: Buffer): string {
  const iv = payload.subarray(0, IV_BYTES)
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
}

/**
 * credentials.enc = iv(12) | auth tag(16) | AES-256-GCM ciphertext of the Credentials JSON.
 * The key is a random 32-byte file next to it with mode 0600. This keeps secrets out of the repo, logs and browser;
 * it does not protect against someone who can read the user's own account files.
 */
export class CredentialStore {
  private cache: Credentials | null = null
  readonly keyPath: string
  readonly credentialsPath: string

  constructor(
    private dir: string,
    private log: (msg: string) => void,
  ) {
    this.keyPath = join(dir, 'key')
    this.credentialsPath = join(dir, 'credentials.enc')
  }

  async load(): Promise<Credentials> {
    if (this.cache) return this.cache
    this.cache = await this.readFromDisk()
    return this.cache
  }

  async update(patch: (current: Credentials) => Credentials): Promise<Credentials> {
    const next = patch(await this.load())
    await ensureDir(this.dir)
    const key = await this.loadOrCreateKey()
    await writeFileAtomic(this.credentialsPath, encrypt(JSON.stringify(next), key))
    this.cache = next
    return next
  }

  /** Deletes both the ciphertext and the key, so nothing recoverable is left on disk. */
  async forget(): Promise<void> {
    await rm(this.credentialsPath, { force: true })
    await rm(this.keyPath, { force: true })
    this.cache = {}
  }

  private async readFromDisk(): Promise<Credentials> {
    let payload: Buffer
    let key: Buffer
    try {
      payload = await readFile(this.credentialsPath)
      key = await readFile(this.keyPath)
    } catch (err) {
      if (isMissing(err)) return {}
      throw err
    }
    try {
      return JSON.parse(decrypt(payload, key)) as Credentials
    } catch {
      // Wrong key or tampered file: start clean rather than crash; the user re-enters credentials in onboarding.
      this.log('Saved credentials could not be decrypted and were ignored.')
      return {}
    }
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    try {
      const key = await readFile(this.keyPath)
      if (key.length === KEY_BYTES) return key
    } catch (err) {
      if (!isMissing(err)) throw err
    }
    const key = randomBytes(KEY_BYTES)
    await writeFileAtomic(this.keyPath, key, 0o600)
    // writeFile's mode is filtered by the umask; chmod makes 0600 explicit (a no-op on Windows).
    await chmod(this.keyPath, 0o600)
    return key
  }
}
