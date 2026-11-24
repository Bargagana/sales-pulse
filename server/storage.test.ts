import { existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CredentialStore, decrypt, encrypt, resolveDataDir } from './storage'
import { makeTempDir } from './test-utils'

const API_KEY = 'sk-live-PLAINTEXT-KEY-0123456789'
const BOT_TOKEN = '123456:PLAINTEXT_BOT_TOKEN'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await makeTempDir()))
afterEach(() => cleanup())

describe('resolveDataDir', () => {
  it('prefers SALES_PULSE_DATA_DIR', () => {
    expect(resolveDataDir({ SALES_PULSE_DATA_DIR: '/tmp/x' }, 'darwin', '/Users/a')).toBe('/tmp/x')
  })
  it('uses the OS user data folder', () => {
    expect(resolveDataDir({}, 'darwin', '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support', 'sales-pulse'))
    expect(resolveDataDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toBe(
      join('C:\\Users\\a\\AppData\\Roaming', 'sales-pulse'),
    )
    expect(resolveDataDir({ XDG_CONFIG_HOME: '/home/a/.cfg' }, 'linux', '/home/a')).toBe(join('/home/a/.cfg', 'sales-pulse'))
    expect(resolveDataDir({}, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'sales-pulse'))
  })
})

describe('AES-256-GCM', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const key = Buffer.alloc(32, 7)
    const a = encrypt('hello', key)
    const b = encrypt('hello', key)
    expect(decrypt(a, key)).toBe('hello')
    expect(a.equals(b)).toBe(false)
  })
  it('rejects a tampered ciphertext', () => {
    const key = Buffer.alloc(32, 7)
    const payload = encrypt('hello', key)
    payload[payload.length - 1]! ^= 1
    expect(() => decrypt(payload, key)).toThrow()
  })
})

describe('CredentialStore', () => {
  const creds = {
    llm: { format: 'openai' as const, baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: API_KEY },
    telegram: { botToken: BOT_TOKEN, chatId: '42' },
    pushToken: 'sp_push',
  }

  it('survives a restart (new store instance) and never writes plaintext', async () => {
    await new CredentialStore(dir, () => {}).update(() => creds)
    expect(await new CredentialStore(dir, () => {}).load()).toEqual(creds)

    const onDisk = await readFile(join(dir, 'credentials.enc'))
    for (const secret of [API_KEY, BOT_TOKEN, 'sp_push']) {
      expect(onDisk.includes(Buffer.from(secret))).toBe(false)
    }
    expect((await readFile(join(dir, 'key'))).length).toBe(32)
  })

  it.skipIf(process.platform === 'win32')('creates the key file with mode 0600', async () => {
    await new CredentialStore(dir, () => {}).update(() => creds)
    expect((await stat(join(dir, 'key'))).mode & 0o777).toBe(0o600)
  })

  it('forget deletes both files', async () => {
    const store = new CredentialStore(dir, () => {})
    await store.update(() => creds)
    await store.forget()
    expect(existsSync(join(dir, 'key'))).toBe(false)
    expect(existsSync(join(dir, 'credentials.enc'))).toBe(false)
    expect(await store.load()).toEqual({})
  })

  it('treats an undecryptable file as empty instead of crashing', async () => {
    await new CredentialStore(dir, () => {}).update(() => creds)
    await writeFile(join(dir, 'key'), Buffer.alloc(32, 1))
    const logs: string[] = []
    expect(await new CredentialStore(dir, (m) => logs.push(m)).load()).toEqual({})
    expect(logs.join()).not.toContain(API_KEY)
  })
})
