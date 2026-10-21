import { beforeEach, describe, expect, it } from 'vitest'
import { hasPasswordRecoveryMarker, setPasswordRecoveryMarker } from './recovery-marker'

describe('password recovery marker', () => {
  beforeEach(() => sessionStorage.clear())

  it('persists the recovery flow across a page reload', () => {
    setPasswordRecoveryMarker(true)
    expect(hasPasswordRecoveryMarker()).toBe(true)
  })

  it('clears the marker when recovery ends', () => {
    setPasswordRecoveryMarker(true)
    setPasswordRecoveryMarker(false)
    expect(hasPasswordRecoveryMarker()).toBe(false)
  })
})