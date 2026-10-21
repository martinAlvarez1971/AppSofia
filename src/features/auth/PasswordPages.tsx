import { useState, type FormEvent } from 'react'
import { KeyRound, Mail } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthFrame } from '../../components/AuthFrame'
import { LoadingState, Notice } from '../../components/PageState'
import { useAuth } from './auth.context'

export function PasswordPages({ mode }: { mode: 'forgot' | 'reset' | 'invite' }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  if (mode !== 'forgot' && auth.status === 'loading') return <LoadingState label="Validando enlace" />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    if (mode === 'forgot') {
      const ok = await auth.recover(email)
      setBusy(false)
      if (ok) setSent(true)
      else setError('No se pudo solicitar la recuperación. Verificá la configuración e intentá nuevamente.')
      return
    }
    if (password.length < 10 || password !== confirmation) {
      setBusy(false)
      setError(password.length < 10 ? 'La contraseña debe tener al menos 10 caracteres.' : 'Las contraseñas no coinciden.')
      return
    }
    const message = await auth.updatePassword(password)
    setBusy(false)
    if (message) setError(message)
    else navigate('/dashboard', { replace: true })
  }

  const isForgot = mode === 'forgot'
  const isInvite = mode === 'invite'
  const canSetPassword = isInvite ? Boolean(auth.session) : auth.passwordRecovery
  const title = isForgot ? 'Restablecer contraseña' : isInvite ? 'Establecé tu contraseña' : 'Elegí una contraseña nueva'
  const description = isForgot
    ? 'Si la cuenta existe, enviaremos un enlace para continuar.'
    : isInvite
      ? 'Completá la invitación con una contraseña única de al menos 10 caracteres.'
      : 'Usá una contraseña única de al menos 10 caracteres.'
  return <AuthFrame title={title} description={description}>
    {!auth.configured ? <Notice title="Falta configurar Supabase" warning>La recuperación estará disponible cuando configures las variables de entorno.</Notice> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {isForgot && sent ? <Notice title="Revisá tu correo">Si la cuenta existe, recibirás un enlace de recuperación.</Notice> : null}
    {!isForgot && !canSetPassword ? <Notice title={isInvite ? 'Invitación no válida o vencida' : 'Enlace no válido o vencido'} warning>{isInvite ? 'Pedile al administrador principal que reenvíe la invitación.' : 'Solicitá un nuevo enlace para continuar.'}</Notice> : null}
    {(!isForgot || !sent) && (isForgot || canSetPassword) ? <form className="auth-form" onSubmit={submit}>
      {isForgot ? <label className="field"><span>Correo electrónico</span><span className="field-control"><Mail size={17} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span></label> : <>
        <label className="field"><span>Nueva contraseña</span><span className="field-control"><KeyRound size={17} /><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} required /></span></label>
        <label className="field"><span>Confirmar contraseña</span><span className="field-control"><KeyRound size={17} /><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={10} required /></span></label>
      </>}
      <button className="button button--primary button--full" disabled={!auth.configured || busy}>{busy ? 'Procesando…' : isForgot ? 'Enviar enlace' : 'Guardar contraseña'}</button>
    </form> : null}
    <p className="auth-note"><Link to="/login">Volver al inicio de sesión</Link></p>
  </AuthFrame>
}
