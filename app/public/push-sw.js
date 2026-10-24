// Importado pelo service worker gerado (vite.config.ts › workbox.importScripts): mostra os avisos
// do plano de refeições e abre o app ao tocar.
self.addEventListener('push', (event) => {
  let dados = {}
  try {
    dados = event.data ? event.data.json() : {}
  } catch {
    dados = { corpo: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(dados.titulo || 'Homefitness', {
      body: dados.corpo || '',
      tag: dados.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: self.registration.scope },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if (j.url.startsWith(self.registration.scope) && 'focus' in j) return j.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
