import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound, LoaderCircle, Plus, ShieldCheck, UserRoundCog, UserRoundMinus, UserRoundPlus } from 'lucide-react'
import { useAuth } from '../auth/auth.context'
import { changeUserStatus, inviteUser, listUsers, sendPasswordReset, transferSuperAdmin, UsersApiError, type ManagedUser } from './users.api'

type NewUserForm = { firstName: string; lastName: string; email: string }

function roleLabel(role: ManagedUser['role']) {
  return role === 'super_admin' ? 'Administrador principal' : 'Operativo'
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(value))
}

export function UsersPage() {
  const { profile, session, signOut } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<NewUserForm>({ firstName: '', lastName: '', email: '' })
  const [error, setError] = useState('')
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [logoutFailed, setLogoutFailed] = useState(false)
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const isLoading = loading && Boolean(session?.access_token)
  const inviteButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  const handleRequestError = useCallback(async (requestError: unknown) => {
    if (requestError instanceof UsersApiError && requestError.status === 401) {
      const logoutError = await signOut()
      if (logoutError) {
        setLogoutFailed(true)
        setErrorStatus(401)
        setError('La sesión venció y no se pudo cerrar localmente. Cerrá esta pestaña e iniciá sesión nuevamente.')
      }
      return
    }
    if (requestError instanceof UsersApiError) setErrorStatus(requestError.status)
    setError(requestError instanceof Error ? requestError.message : 'No se pudo completar la operación.')
  }, [signOut])

  useEffect(() => {
    if (!showCreate) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusable = () => dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], textarea:not(:disabled)',
    )
    focusable()?.[0]?.focus()

    function handleDialogKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setShowCreate(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items?.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleDialogKey)
    return () => {
      document.removeEventListener('keydown', handleDialogKey)
      previousFocus?.focus()
    }
  }, [showCreate])

  useEffect(() => {
    const token = session?.access_token
    if (!token) return
    let active = true
    void listUsers(token).then((rows) => {
      if (active) {
        setUsers(rows)
        setError('')
      }
    }).catch((requestError: unknown) => {
      if (active) {
        setUsers([])
        void handleRequestError(requestError)
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [session?.access_token, refresh, signOut, handleRequestError])

  function clearMessages() {
    setError('')
    setErrorStatus(null)
    setLogoutFailed(false)
    setNotice('')
  }

  function refreshUsers() {
    setError('')
    setLogoutFailed(false)
    setLoading(true)
    setRefresh((value) => value + 1)
  }

  async function retryLogout() {
    const logoutError = await signOut()
    if (logoutError) setError(logoutError)
    else {
      setLogoutFailed(false)
      setError('')
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = session?.access_token
    if (!token) return
    clearMessages()
    setBusyId('create')
    try {
      const result = await inviteUser(token, { ...form, role: 'operational_admin' })
      setNotice(result.invitationSent ? `Invitación enviada a ${result.user.email}.` : 'La cuenta fue creada.')
      setShowCreate(false)
      setForm({ firstName: '', lastName: '', email: '' })
      refreshUsers()
    } catch (requestError) {
      void handleRequestError(requestError)
    } finally {
      setBusyId(null)
    }
  }

  async function handleStatus(user: ManagedUser) {
    const nextStatus = user.status === 'active' ? 'inactive' : 'active'
    const action = nextStatus === 'inactive' ? 'desactivar' : 'activar'
    if (!window.confirm(`¿Querés ${action} la cuenta de ${user.firstName ?? user.email}? ${nextStatus === 'inactive' ? 'Se bloqueará su acceso, pero se conservará el historial.' : ''}`)) return
    const token = session?.access_token
    if (!token) return
    clearMessages()
    setBusyId(user.id)
    try {
      await changeUserStatus(token, user.id, nextStatus)
      setNotice(`Cuenta ${nextStatus === 'active' ? 'activada' : 'desactivada'}.`)
      refreshUsers()
    } catch (requestError) {
      void handleRequestError(requestError)
    } finally {
      setBusyId(null)
    }
  }

  async function handleReset(user: ManagedUser) {
    if (!window.confirm(`¿Enviar un enlace para restablecer la contraseña a ${user.email}?`)) return
    const token = session?.access_token
    if (!token) return
    clearMessages()
    setBusyId(user.id)
    try {
      const result = await sendPasswordReset(token, user.id)
      setNotice(result.message)
    } catch (requestError) {
      void handleRequestError(requestError)
    } finally {
      setBusyId(null)
    }
  }

  async function handleTransfer(user: ManagedUser) {
    const confirmed = window.confirm(`Transferir el rol de Administrador Principal a ${user.firstName ?? user.email}? Tu cuenta pasará a ser operativa y se cerrará tu sesión.`)
    if (!confirmed) return
    const token = session?.access_token
    if (!token) return
    clearMessages()
    setBusyId(user.id)
    try {
      await transferSuperAdmin(token, user.id)
      setNotice('Rol transferido. Cerrando tu sesión…')
      const logoutError = await signOut()
      if (logoutError) {
        setLogoutFailed(true)
        setErrorStatus(null)
        setError(`El rol se transfirió, pero no se pudo cerrar la sesión: ${logoutError}`)
      }
    } catch (requestError) {
      void handleRequestError(requestError)
    } finally {
      setBusyId(null)
    }
  }

  return <div className="users-page">
    <div className="page-heading users-heading">
      <div>
        <span className="eyebrow">ADMINISTRACIÓN</span>
        <h1>Cuentas de administradores</h1>
        <p>Invitaciones, accesos y responsabilidades del equipo.</p>
      </div>
      <span className="role-pill"><ShieldCheck size={15} />{profile?.role === 'super_admin' ? 'Administrador principal' : 'Acceso restringido'}</span>
    </div>

    {(error || (!session?.access_token ? 'No se encontró una sesión válida. Iniciá sesión nuevamente.' : '')) ? <div className="users-message" role="alert"><p className="form-error">{error || 'No se encontró una sesión válida. Iniciá sesión nuevamente.'}</p>{logoutFailed ? <button className="button button--quiet" type="button" onClick={() => void retryLogout()}>Reintentar cerrar sesión</button> : errorStatus !== 403 && errorStatus !== 401 ? <button className="button button--quiet" type="button" onClick={refreshUsers}>Reintentar carga</button> : null}</div> : null}
    {notice ? <p className="users-success" role="status">{notice}</p> : null}

    <section className="users-toolbar" aria-label="Acciones de cuentas">
      <div><strong>{users.length}</strong><span>{users.length === 1 ? ' cuenta' : ' cuentas'}</span></div>
      <button ref={inviteButtonRef} className="button button--primary" type="button" disabled={logoutFailed} onClick={() => { clearMessages(); setShowCreate(true) }}>
        <Plus size={17} /> Invitar administrador
      </button>
    </section>

    <div className="users-table-wrap">
      <table className="users-table">
        <thead><tr><th scope="col">Administrador</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Creada</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          {isLoading ? <tr><td colSpan={5} className="users-empty"><LoaderCircle className="spin" size={19} />Cargando cuentas</td></tr> : null}
          {!isLoading && users.length === 0 && !error ? <tr><td colSpan={5} className="users-empty">No hay cuentas para mostrar.</td></tr> : null}
          {!isLoading && users.length === 0 && error && errorStatus !== 401 && errorStatus !== 403 ? <tr><td colSpan={5} className="users-empty"><button className="button button--quiet" type="button" onClick={refreshUsers}>Reintentar carga</button></td></tr> : null}
          {!isLoading ? users.map((user) => <tr key={user.id}>
            <td data-label="Administrador"><div className="user-cell"><span className="user-avatar" aria-hidden="true">{(user.firstName || user.email).slice(0, 1).toUpperCase()}</span><span><strong>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Sin nombre'}</strong><small>{user.email}</small></span></div></td>
            <td data-label="Rol"><span className={`role-tag${user.role === 'super_admin' ? ' role-tag--principal' : ''}`}>{roleLabel(user.role)}</span></td>
            <td data-label="Estado"><span className={`status-tag status-tag--${user.status}`}>{user.status === 'active' ? 'Activo' : 'Inactivo'}</span></td>
            <td data-label="Creada" className="user-date">{dateLabel(user.createdAt)}</td>
            <td data-label="Acciones"><div className="user-actions">
              {user.role === 'operational_admin' && user.status === 'active' ? <button className="icon-action" type="button" title="Transferir rol de administrador principal" aria-label={`Transferir rol principal a ${user.email}`} disabled={busyId !== null || logoutFailed} onClick={() => void handleTransfer(user)}><ShieldCheck size={17} /></button> : null}
              <button className="icon-action" type="button" title="Enviar recuperación de contraseña" aria-label={`Enviar recuperación a ${user.email}`} disabled={busyId !== null || logoutFailed || user.status !== 'active' || user.id === profile?.id} onClick={() => void handleReset(user)}><KeyRound size={17} /></button>
              {user.id !== profile?.id && user.role !== 'super_admin' ? <button className="icon-action" type="button" title={user.status === 'active' ? 'Desactivar cuenta' : 'Activar cuenta'} aria-label={`${user.status === 'active' ? 'Desactivar' : 'Activar'} ${user.email}`} disabled={busyId !== null || logoutFailed} onClick={() => void handleStatus(user)}>{user.status === 'active' ? <UserRoundMinus size={17} /> : <UserRoundPlus size={17} />}</button> : null}
              {busyId === user.id ? <LoaderCircle className="spin" size={16} aria-label="Procesando" /> : null}
            </div></td>
          </tr>) : null}
        </tbody>
      </table>
    </div>

    <p className="users-footnote"><UserRoundCog size={16} /> Las cuentas se conservan para mantener la trazabilidad. Las invitaciones llegan por correo; no se comparte una contraseña temporal.</p>

    {showCreate ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false) }}>
      <section ref={dialogRef} className="users-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" tabIndex={-1}>
        <div className="users-modal__heading"><div><span className="eyebrow">NUEVA CUENTA</span><h2 id="invite-title">Invitar administrador</h2></div><button className="icon-action" type="button" aria-label="Cerrar" onClick={() => setShowCreate(false)}>×</button></div>
        <p>Enviaremos un enlace seguro para aceptar la invitación y establecer una contraseña.</p>
        <form className="users-form" onSubmit={(event) => void handleCreate(event)}>
          <label className="field"><span>Nombre</span><input required maxLength={100} autoComplete="given-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label>
          <label className="field"><span>Apellido</span><input required maxLength={100} autoComplete="family-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label>
          <label className="field"><span>Correo electrónico</span><input required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label className="field"><span>Rol</span><select value="operational_admin" disabled><option value="operational_admin">Administrador operativo</option></select></label>
          <p className="users-form__note">El administrador principal es único. La transferencia se realiza desde una cuenta operativa activa.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="users-modal__actions"><button className="button button--quiet" type="button" disabled={busyId !== null} onClick={() => setShowCreate(false)}>Cancelar</button><button className="button button--primary" type="submit" disabled={busyId !== null}>{busyId === 'create' ? 'Enviando…' : 'Enviar invitación'}</button></div>
        </form>
      </section>
    </div> : null}
  </div>
}