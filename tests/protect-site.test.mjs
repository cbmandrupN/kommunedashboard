import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { protectSite } from '../scripts/protect-site.mjs'

test('protects the app, municipality JSON and Excel with authenticated encryption', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dashboard-access-'))
  const dist = path.join(temporary, 'dist')
  const password = 'test-password-not-used-in-production'
  try {
    await mkdir(path.join(dist, 'assets'), { recursive: true })
    await mkdir(path.join(dist, 'buildings'))
    await mkdir(path.join(dist, 'exports-from-60-with-coowners'))
    await writeFile(path.join(dist, 'index.html'),
      '<script type="module" src="/kommunedashboard/assets/app.js"></script><link rel="stylesheet" href="/kommunedashboard/assets/app.css">')
    const fixtures = {
      'assets/app.js': 'window.dashboardStarted = true',
      'assets/app.css': 'body { color: red }',
      'buildings/29189579.json': '{"buildings":["private-test-data"]}',
      'exports-from-60-with-coowners/29189579.xlsx': Buffer.from([80, 75, 3, 4, 255, 0, 128]),
    }
    for (const [name, bytes] of Object.entries(fixtures)) {
      await writeFile(path.join(dist, name), bytes)
    }
    await assert.rejects(protectSite(dist, ''), /DASHBOARD_PASSWORD/)
    await protectSite(dist, password)
    assert.deepEqual((await readdir(dist)).sort(),
      ['access.css', 'access.js', 'access.json', 'index.html', 'protected'])
    const config = JSON.parse(await readFile(path.join(dist, 'access.json'), 'utf8'))
    assert.equal(config.iterations, 600_000)
    const salt = Buffer.from(config.salt, 'base64')
    assert.equal(salt.length, 16)
    async function derive(value) {
      const material = await webcrypto.subtle.importKey('raw', Buffer.from(value), 'PBKDF2', false, ['deriveKey'])
      return webcrypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: config.iterations, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
      )
    }
    async function decrypt(url, key, name, tamper = false) {
      const bytes = await readFile(path.join(dist, url))
      if (tamper) bytes[12] ^= 1
      const result = await webcrypto.subtle.decrypt({
        name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: Buffer.from(name),
      }, key, bytes.subarray(12))
      return gunzipSync(Buffer.from(result))
    }
    const key = await derive(password)
    const manifest = JSON.parse(await decrypt(config.manifest, key, 'manifest'))
    assert.equal(manifest.entry, 'assets/app.js')
    assert.deepEqual(manifest.styles, ['assets/app.css'])
    for (const [name, expected] of Object.entries(fixtures)) {
      assert.deepEqual(await decrypt(manifest.files[name].url, key, name), Buffer.from(expected))
    }
    await assert.rejects(decrypt(config.manifest, await derive('wrong-password'), 'manifest'))
    await assert.rejects(decrypt(config.manifest, key, 'manifest', true))
    await assert.rejects(decrypt(manifest.files['assets/app.js'].url, key, 'other-file'))
    for (const filename of await readdir(path.join(dist, 'protected'))) {
      const bytes = await readFile(path.join(dist, 'protected', filename))
      assert.equal(bytes.includes(Buffer.from(password)), false)
      assert.equal(bytes.includes(Buffer.from('private-test-data')), false)
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
