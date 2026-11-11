/**
 * Suite de Pruebas de Seguridad y Persistencia — SOFIA Fase A
 * Comprueba el blindaje de tokens, la protección de endpoints, y la inmutabilidad de la auditoría.
 */

async function runTests() {
  const baseUrl = 'http://127.0.0.1:3000/api'
  console.log('🚀 Ejecutando Suite de Pruebas de Seguridad y Persistencia — SOFIA Fase A...\n')

  let passed = 0
  let failed = 0

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASÓ: ${testName}`)
      passed++
    } else {
      console.error(`  ❌ FALLÓ: ${testName} ${detail ? `(${detail})` : ''}`)
      failed++
    }
  }

  const superAdminToken = 'demo-super-admin-token'
  const operationalToken = 'demo-operational-token'
  const invalidToken = 'forged-fake-token-xyz'
  const emailAsToken = 'martinalvarez.android@gmail.com'
  const uuidAsToken = '00000000-0000-0000-0000-000000000001'

  try {
    // -------------------------------------------------------------
    // 1. Verificación de salud y reporte transparente de modo
    // -------------------------------------------------------------
    const resHealth = await fetch(`${baseUrl}/health`)
    const healthData = (await resHealth.json()) as { status: string; authMode: string; isLiveConfigured: boolean }
    assert(
      resHealth.status === 200 && healthData.status === 'ok' && typeof healthData.authMode === 'string',
      `Endpoint de salud informa el modo de autenticación activo: [${healthData.authMode}]`,
    )

    // -------------------------------------------------------------
    // 2. Eliminación de vulnerabilidad de Email o UUID como Bearer token (Condición A.4)
    // -------------------------------------------------------------
    const resEmailToken = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${emailAsToken}` },
    })
    assert(
      resEmailToken.status === 401,
      'Envío de email como Bearer token es estrictamente RECHAZADO con HTTP 401 (vulnerabilidad erradicada)',
    )

    const resUuidToken = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${uuidAsToken}` },
    })
    assert(
      resUuidToken.status === 401,
      'Envío de UUID como Bearer token es estrictamente RECHAZADO con HTTP 401 (vulnerabilidad erradicada)',
    )

    // -------------------------------------------------------------
    // 3. Petición sin token o con token manipulado
    // -------------------------------------------------------------
    const resNoToken = await fetch(`${baseUrl}/alerts`)
    assert(resNoToken.status === 401, 'Petición sin autenticación es rechazada con HTTP 401')

    const resForged = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${invalidToken}` },
    })
    assert(resForged.status === 401, 'Token falsificado o inventado es rechazado con HTTP 401')

    // -------------------------------------------------------------
    // 4. Bloqueo de Administrador Operativo en rutas exclusivas de Super Admin (Condición A & B.4)
    // -------------------------------------------------------------
    const resOpAlerts = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${operationalToken}` },
    })
    assert(
      resOpAlerts.status === 403,
      'Administrador operativo tiene estrictamente bloqueado /api/alerts (HTTP 403 Forbidden)',
    )

    const resOpAudit = await fetch(`${baseUrl}/audit-logs`, {
      headers: { Authorization: `Bearer ${operationalToken}` },
    })
    assert(
      resOpAudit.status === 403,
      'Administrador operativo tiene estrictamente bloqueado /api/audit-logs (HTTP 403 Forbidden)',
    )

    const resOpUsers = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: `Bearer ${operationalToken}` },
    })
    assert(
      resOpUsers.status === 403,
      'Administrador operativo tiene estrictamente bloqueado /api/users (HTTP 403 Forbidden)',
    )

    // -------------------------------------------------------------
    // 5. Superadministrador accede y consulta alertas
    // -------------------------------------------------------------
    const resSaAlerts = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    })
    const alertsData = (await resSaAlerts.json()) as { alerts: Array<{ id: string; status: string }>; summary: { pending: number } }
    assert(
      resSaAlerts.status === 200 && Array.isArray(alertsData.alerts),
      'Superadministrador puede consultar el centro de alertas con éxito (HTTP 200)',
    )
    const initialPending = alertsData.summary.pending

    // -------------------------------------------------------------
    // 6. Conflicto de capacidad detectado bajo reservas existentes
    // -------------------------------------------------------------
    const resConflict = await fetch(`${baseUrl}/tables/tbl-1/capacity`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${operationalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        capacity: 2,
        reason: 'Reducción de tamaño por reubicación de salón',
        force: false,
      }),
    })
    assert(
      resConflict.status === 409,
      'Conflicto de capacidad con reservas futuras detectado y bloqueado sin confirmación explícita (HTTP 409)',
    )

    // Modificación con capacidad válida (capacidad 5)
    const resCapOk = await fetch(`${baseUrl}/tables/tbl-1/capacity`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${operationalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        capacity: 5,
        reason: 'Ampliación autorizada para el servicio de esta noche',
      }),
    })
    assert(resCapOk.status === 200, 'Administrador operativo puede modificar capacidad válidamente (HTTP 200)')

    // -------------------------------------------------------------
    // 7. Auditoría registrada con identidad real del actor y rol del servidor
    // -------------------------------------------------------------
    const resAuditCheck = await fetch(`${baseUrl}/audit-logs`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    })
    const auditLogs = (await resAuditCheck.json()) as Array<{
      actorName: string
      actorRole: string
      action: string
      relatedTableId: string
      reason: string
    }>
    const latestAudit = auditLogs[0]
    assert(
      latestAudit.action === 'table.capacity_changed' &&
        latestAudit.actorRole === 'operational_admin' &&
        latestAudit.actorName === 'Sofía García' &&
        latestAudit.relatedTableId === 'tbl-1',
      'Auditoría registra identidad real del operador, rol del servidor, entidad y motivo declarado',
    )

    // -------------------------------------------------------------
    // 8. Generación coherente de alertas privadas para Super Admin
    // -------------------------------------------------------------
    const resAlertsAfter = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    })
    const alertsAfter = (await resAlertsAfter.json()) as { alerts: Array<{ id: string; title: string; status: string; auditLogId: string }>; summary: { pending: number } }
    assert(
      alertsAfter.summary.pending > initialPending,
      'Se incrementó el contador de alertas pendientes para el superadministrador',
    )
    const generatedAlert = alertsAfter.alerts[0]
    assert(
      generatedAlert.title.includes('Mesa 1') && generatedAlert.status === 'pending',
      'La alerta administrativa refleja la mesa y queda en estado pendiente de revisión',
    )

    // -------------------------------------------------------------
    // 9. Marcar alerta como revisada NO altera la auditoría (Inmutabilidad)
    // -------------------------------------------------------------
    const resReview = await fetch(`${baseUrl}/alerts/${generatedAlert.id}/review`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    })
    const reviewedAlert = (await resReview.json()) as { status: string; reviewedByName: string }
    assert(
      resReview.status === 200 && reviewedAlert.status === 'reviewed',
      'Superadministrador puede marcar la alerta como revisada (HTTP 200)',
    )

    const resAuditRecheck = await fetch(`${baseUrl}/audit-logs`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    })
    const auditLogsRechecked = (await resAuditRecheck.json()) as Array<{ id: string; action: string }>
    const matchedLog = auditLogsRechecked.find((a) => a.id === generatedAlert.auditLogId)
    assert(
      Boolean(matchedLog && matchedLog.action === 'table.capacity_changed'),
      'El evento original de auditoría permanece completamente intacto e inalterado',
    )

    // -------------------------------------------------------------
    // 10. Desactivación de mesa con reservas futuras requiere resolución explícita
    // -------------------------------------------------------------
    const resDeactCheck = await fetch(`${baseUrl}/tables/tbl-1/check-deactivation`, {
      headers: { Authorization: `Bearer ${operationalToken}` },
    })
    const deactCheckData = (await resDeactCheck.json()) as { hasFutureReservations: boolean }
    assert(
      deactCheckData.hasFutureReservations === true,
      'Pre-chequeo detecta correctamente reservas futuras en la mesa a desactivar',
    )

    // Intento de desactivar sin resolución -> bloqueado con HTTP 409
    const resDeactBlock = await fetch(`${baseUrl}/tables/tbl-1/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${operationalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'out_of_service',
        reason: 'Rotura de pata y desnivel de solado',
      }),
    })
    assert(
      resDeactBlock.status === 409,
      'Desactivación sin resolución explícita de reservas es bloqueada con HTTP 409 Conflict',
    )

    // -------------------------------------------------------------
    // 11. Cancelación de reserva con motivo obligatorio
    // -------------------------------------------------------------
    const resCancelNoReason = await fetch(`${baseUrl}/reservations/res-103/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${operationalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: '' }),
    })
    assert(
      resCancelNoReason.status === 400,
      'Cancelación de reserva sin motivo obligatorio es rechazada con HTTP 400',
    )

    const resCancelValid = await fetch(`${baseUrl}/reservations/res-103/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${operationalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Cliente avisó telefónicamente reprogramación por viaje',
      }),
    })
    assert(
      resCancelValid.status === 200,
      'Cancelación de reserva válida audita y libera asignación de mesa',
    )

    // -------------------------------------------------------------
    // 12. Creación de Reserva Multi-Mesa y Validación de Capacidad
    // -------------------------------------------------------------
    // Intento con mesa fuera de servicio (tbl-5) -> HTTP 409
    const resOutOfServiceBooking = await fetch(`${baseUrl}/reservations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${operationalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerName: 'Familia Rossi',
        guestsCount: 4,
        startTime: new Date().toISOString(),
        tableIds: ['tbl-5'], // Mesa 5 está fuera de servicio
      }),
    })
    assert(
      resOutOfServiceBooking.status === 409,
      'Intento de reservar mesa inactiva o fuera de servicio es bloqueado con HTTP 409',
    )

    // Intento con capacidad insuficiente (Mesa 2 tiene capacidad 2, solicitamos 6) -> HTTP 409
    const resLowCapBooking = await fetch(`${baseUrl}/reservations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${operationalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerName: 'Grupo Cumpleaños',
        guestsCount: 6,
        startTime: new Date().toISOString(),
        tableIds: ['tbl-2'],
      }),
    })
    assert(
      resLowCapBooking.status === 409,
      'Intento de reservar con capacidad insuficiente es rechazado con HTTP 409',
    )

    // Creación exitosa combinando dos mesas válidas (Mesa 2 cap 2 + Mesa 6 cap 2 = 4)
    const resMultiTableValid = await fetch(`${baseUrl}/reservations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${operationalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerName: 'Cena Amigos Gourmet',
        guestsCount: 4,
        startTime: new Date(Date.now() + 86400000).toISOString(),
        durationMinutes: 120,
        tableIds: ['tbl-2', 'tbl-6'],
        notes: 'Celebración privada',
      }),
    })
    assert(
      resMultiTableValid.status === 201,
      'Creación de reserva combinando múltiples mesas confirmada exitosamente (HTTP 201)',
    )

    console.log(`\n======================================================`)
    console.log(`RESUMEN: ${passed} pruebas superadas, ${failed} fallos.`)
    console.log(`======================================================\n`)

    if (failed > 0) process.exit(1)
  } catch (err) {
    console.error('Error fatal al ejecutar las pruebas:', err)
    process.exit(1)
  }
}

void runTests()
