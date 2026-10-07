import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const iterations = 600_000
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

export async function protectSite(directory, password) {
  if (!password) throw new Error('DASHBOARD_PASSWORD must be configured before deployment')
  const html = await readFile(path.join(directory, 'index.html'), 'utf8')
  const entry = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/)?.[1]
  if (!entry) throw new Error('Built dashboard module entry was not found')
  const relativeAsset = (url) => url.replace(/^\/kommunedashboard\//, '')
  const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map((match) => relativeAsset(match[1]))
  const salt = randomBytes(16)
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const output = `${directory}.protected`
  await mkdir(output)
  await mkdir(path.join(output, 'protected'))

  async function encrypt(bytes, name) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(name))
    const compressed = gzipSync(bytes)
    const encrypted = Buffer.concat([iv, cipher.update(compressed), cipher.final(), cipher.getAuthTag()])
    const filename = `${createHash('sha256').update(encrypted).digest('hex')}.bin`
    await writeFile(path.join(output, 'protected', filename), encrypted)
    return `protected/${filename}`
  }

  const files = {}
  async function walk(folder, prefix = '') {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const source = path.join(folder, item.name)
      const name = `${prefix}${item.name}`
      if (item.isDirectory()) await walk(source, `${name}/`)
      else if (item.isFile()) {
        files[name] = {
          url: await encrypt(await readFile(source), name),
          type: types[path.extname(name)] ?? 'application/octet-stream',
        }
      } else throw new Error(`Unsupported build asset: ${name}`)
    }
  }

  try {
    await walk(directory)
    const main = relativeAsset(entry)
    if (!files[main] || styles.some((style) => !files[style])) {
      throw new Error('A dashboard entry asset is missing')
    }
    const manifest = await encrypt(Buffer.from(JSON.stringify({ entry: main, styles, files })), 'manifest')
    await writeFile(path.join(output, 'access.json'), JSON.stringify({
      salt: salt.toString('base64'),
      iterations,
      manifest,
    }))
    for (const name of ['index.html', 'access.js', 'access.css']) {
      await cp(path.join(scriptDirectory, 'access', name), path.join(output, name))
    }
    await rm(directory, { recursive: true })
    await cp(output, directory, { recursive: true })
  } finally {
    key.fill(0)
    await rm(output, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await protectSite(path.resolve('dist'), process.env.DASHBOARD_PASSWORD)
  console.log('Protected dashboard, building data and downloads for deployment.')
}
