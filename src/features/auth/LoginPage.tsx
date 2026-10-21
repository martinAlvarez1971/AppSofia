import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, KeyRound, Mail } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthFrame } from '../../components/AuthFrame'
import { LoadingState, Notice } from '../../components/PageState'
import { useAuth } from './auth.context'

export function LoginPage() {
  const { signIn, status, configured, session, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [redirectAfterSignIn, setRedirectAfterSignIn] = useState<string | null>(null)
  const destination = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  useEffect(() => {
    if (!session || status === 'loading') return
    if (redirectAfterSignIn || profile?.status === 'active') {
      navigate(redirectAfterSignIn ?? '/dashboard', { replace: true })
    }
  }, [session, status, profile, redirectAfterSignIn, navigate])

  if (status === 'loading') return <LoadingState label="Preparando acceso" />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const message = await signIn(email, password)
    setBusy(false)
    if (message) setError(message)
    else setRedirectAfterSignIn(destination)
  }

  return <AuthFrame title="Bienvenida a SOFIA" description="Ingresá con la cuenta que te asignó el administrador principal.">
    {!configured ? <Notice title="Falta configurar Supabase" warning>Completá <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> en <code>.env.local</code>. El acceso todavía no está habilitado.</Notice> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <form className="auth-form" onSubmit={submit}>
      <label className="field"><span>Correo electrónico</span><span className="field-control"><Mail size={17} /><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></span></label>
      <label className="field"><span>Contraseña</span><span className="field-control"><KeyRound size={17} /><input type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="icon-button" type="button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
      <div className="form-link"><Link to="/auth/forgot-password">¿Olvidaste tu contraseña?</Link></div>
      <button className="button button--primary button--full" disabled={!configured || busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'}</button>
    </form>
    <p className="auth-note">Acceso privado para el equipo del establecimiento.</p>
  </AuthFrame>
}