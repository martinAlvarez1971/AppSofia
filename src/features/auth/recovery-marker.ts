const markerKey = 'sofia.password-recovery'

export function hasPasswordRecoveryMarker() {
  try {
    return window.sessionStorage.getItem(markerKey) === 'true'
  } catch {
    return false
  }
}

export function setPasswordRecoveryMarker(active: boolean) {
  try {
    if (active) window.sessionStorage.setItem(markerKey, 'true')
    else window.sessionStorage.removeItem(markerKey)
  } catch {
    return
  }
}