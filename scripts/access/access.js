const form = document.getElementById('access-form')
const passwordInput = document.getElementById('access-password')
const button = form.querySelector('button')
const errorMessage = document.getElementById('access-error')
const root = document.getElementById('root')
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const site = new URL('./', window.location.href)

async function fetchFile(url, options) {
  const response = await fetch(new URL(url, site), { ...options, cache: 'no-store' })
  if (!response.ok) throw new Error(`Filerne kunne ikke hentes (${response.status}). Genindlæs siden og prøv igen.`)
  return response
}

async function decrypt(bytes, key, name) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(name) },
    key,
    bytes.slice(12),
  )
  const stream = new Blob([decrypted]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (button.disabled) return
  errorMessage.hidden = true
  passwordInput.removeAttribute('aria-invalid')
  button.disabled = true
  button.textContent = 'Åbner dashboard…'
  form.setAttribute('aria-busy', 'true')
  const objectUrls = []
  try {
    if (!crypto.subtle || !window.DecompressionStream) {
      throw new Error('Din browser kan ikke åbne dashboardet. Brug en opdateret version af Edge, Chrome, Firefox eller Safari.')
    }
    const config = await (await fetchFile('access.json')).json()
    const material = await crypto.subtle.importKey(
      'raw', encoder.encode(passwordInput.value), 'PBKDF2', false, ['deriveKey'],
    )
    passwordInput.value = ''
    const salt = Uint8Array.from(atob(config.salt), (character) => character.charCodeAt(0))
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: config.iterations, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    )
    const manifestBytes = new Uint8Array(await (await fetchFile(config.manifest)).arrayBuffer())
    const manifest = JSON.parse(decoder.decode(await decrypt(manifestBytes, key, 'manifest')))

    async function read(name, options = {}) {
      options.signal?.throwIfAborted()
      const file = manifest.files[name]
      if (!file) throw new Error('Den ønskede fil findes ikke. Genindlæs siden og prøv igen.')
      const response = await fetchFile(file.url, options)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const content = await decrypt(bytes, key, name)
      options.signal?.throwIfAborted()
      return new Response(content, { headers: { 'Content-Type': file.type } })
    }

    const styles = await Promise.all(manifest.styles.map(async (name) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = URL.createObjectURL(await (await read(name)).blob())
      objectUrls.push(link.href)
      await new Promise((resolve, reject) => {
        link.onload = resolve
        link.onerror = () => reject(new Error('Dashboardets layout kunne ikke indlæses. Genindlæs siden og prøv igen.'))
        document.head.append(link)
      })
      return link
    }))
    const moduleUrl = URL.createObjectURL(await (await read(manifest.entry)).blob())
    objectUrls.push(moduleUrl)
    window.dashboardAccess = { read }
    root.hidden = false
    await import(moduleUrl)
    document.getElementById('access-panel').remove()
    document.body.classList.remove('access-page')
    document.title = 'Kommunedashboard · Energimærker'
    // Keep decrypted styles and the module alive only for this page session.
    window.addEventListener('pagehide', () => {
      delete window.dashboardAccess
      styles.forEach((style) => style.remove())
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
    }, { once: true })
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) window.location.reload()
    })
  } catch (error) {
    delete window.dashboardAccess
    root.hidden = true
    root.replaceChildren()
    objectUrls.forEach((url) => {
      document.querySelector(`link[href="${url}"]`)?.remove()
      URL.revokeObjectURL(url)
    })
    const invalidCode = error instanceof DOMException && error.name === 'OperationError'
    errorMessage.textContent = invalidCode
      ? 'Koden er ikke korrekt. Prøv igen.'
      : error instanceof TypeError
        ? 'Dashboardet kunne ikke indlæses. Kontrollér forbindelsen, genindlæs siden og prøv igen.'
        : error instanceof Error ? error.message : 'Dashboardet kunne ikke åbnes. Genindlæs siden og prøv igen.'
    errorMessage.hidden = false
    if (invalidCode) passwordInput.setAttribute('aria-invalid', 'true')
    passwordInput.focus()
  } finally {
    button.disabled = false
    button.textContent = 'Åbn dashboard'
    form.removeAttribute('aria-busy')
  }
})
