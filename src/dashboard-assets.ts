declare global {
  interface Window {
    dashboardAccess?: {
      read: (path: string, options?: RequestInit) => Promise<Response>
    }
  }
}

export function fetchDashboardAsset(path: string, options?: RequestInit) {
  return window.dashboardAccess
    ? window.dashboardAccess.read(path, options)
    : fetch(`${import.meta.env.BASE_URL}${path}`, options)
}
