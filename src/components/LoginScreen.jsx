import { useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, LogIn, Mail, User, UserPlus } from 'lucide-react';
import { BrandMark } from './BrandMark.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

const EMPTY = { username: '', name: '', email: '', email2: '', password: '' };

export function LoginScreen({ onLogin, onSignIn, onSignUp, theme, onToggleTheme }) {
    const [mode, setMode] = useState('admin'); // 'admin' | 'signin' | 'signup'
    const [form, setForm] = useState(EMPTY);
    const [showPass, setShowPass] = useState(false);
    const [error, setError] = useState(null);
    const [note, setNote] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    function update(key, value) {
        setForm(prev => ({ ...prev, [key]: value }));
    }

    function switchMode(next) {
        setMode(next);
        setForm(EMPTY);
        setError(null);
        setNote(null);
        setShowPass(false);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setNote(null);

        // ---- validation per mode ----
        if (mode === 'signup') {
            if (!form.name.trim())          return setError('Please enter your name.');
            if (!form.email.trim())         return setError('Please enter your email.');
            if (form.email.trim() !== form.email2.trim()) return setError('The two emails don’t match.');
            if (form.password.length < 6)   return setError('Password must be at least 6 characters.');
        } else if (mode === 'signin') {
            if (!form.email.trim() || !form.password) return setError('Enter your email and password.');
        }

        setSubmitting(true);
        try {
            if (mode === 'admin') {
                const r = await onLogin(form.username.trim(), form.password);
                if (!r.ok) { setError(r.error); setForm(f => ({ ...f, password: '' })); }
            } else if (mode === 'signin') {
                const r = await onSignIn({ email: form.email.trim(), password: form.password });
                if (!r.ok) { setError(r.error); setForm(f => ({ ...f, password: '' })); }
            } else {
                const r = await onSignUp({
                    name: form.name.trim(),
                    email: form.email.trim(),
                    password: form.password,
                });
                if (!r.ok) {
                    setError(r.error);
                } else if (!r.signedIn) {
                    // email confirmation is enabled — bounce to sign-in with a note
                    switchMode('signin');
                    setNote('Account created. Check your email to confirm, then sign in.');
                }
                // if signedIn, parent unmounts this screen
            }
        } finally {
            setSubmitting(false);
        }
    }

    const copy = {
        admin:  { h: 'Welcome back',       p: 'Sign in to manage TikTok publishing accounts.' },
        signin: { h: 'Member sign in',     p: 'Use the email and password you signed up with.' },
        signup: { h: 'Create your account', p: 'Join the workspace to get started.' },
    }[mode];

    const submitLabel = {
        admin:  submitting ? 'Signing in…'  : 'Sign in',
        signin: submitting ? 'Signing in…'  : 'Sign in',
        signup: submitting ? 'Creating…'    : 'Sign up',
    }[mode];

    return (
        <section className="auth-shell">
            <div className="auth-bg" aria-hidden="true">
                <div className="orb orb-a" />
                <div className="orb orb-b" />
                <div className="orb orb-c" />
                <div className="grid-overlay" />
            </div>

            <ThemeToggle floating theme={theme} onToggle={onToggleTheme} />

            <div className="auth-card">
                <div className="auth-brand">
                    <BrandMark gradientId="login-grad" />
                    <div>
                        <p className="brand-eyebrow">Alluvi</p>
                        <h1 className="brand-title">Onboarding Console</h1>
                    </div>
                </div>

                <div className="auth-copy">
                    <h2>{copy.h}</h2>
                    <p>{copy.p}</p>
                </div>

                <form className="auth-form" onSubmit={handleSubmit} noValidate>
                    {mode === 'admin' && (
                        <label className="field">
                            <span className="field-label">Username</span>
                            <div className="field-input">
                                <User />
                                <input
                                    type="text"
                                    autoComplete="username"
                                    placeholder="admin"
                                    value={form.username}
                                    onChange={e => update('username', e.target.value)}
                                    required
                                />
                            </div>
                        </label>
                    )}

                    {mode === 'signup' && (
                        <label className="field">
                            <span className="field-label">Name</span>
                            <div className="field-input">
                                <User />
                                <input
                                    type="text"
                                    autoComplete="name"
                                    placeholder="Your name"
                                    value={form.name}
                                    onChange={e => update('name', e.target.value)}
                                    required
                                />
                            </div>
                        </label>
                    )}

                    {(mode === 'signin' || mode === 'signup') && (
                        <label className="field">
                            <span className="field-label">Email</span>
                            <div className="field-input">
                                <Mail />
                                <input
                                    type="email"
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    value={form.email}
                                    onChange={e => update('email', e.target.value)}
                                    required
                                />
                            </div>
                        </label>
                    )}

                    {mode === 'signup' && (
                        <label className="field">
                            <span className="field-label">Re-enter email</span>
                            <div className="field-input">
                                <Mail />
                                <input
                                    type="email"
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    value={form.email2}
                                    onChange={e => update('email2', e.target.value)}
                                    required
                                />
                            </div>
                        </label>
                    )}

                    <label className="field">
                        <span className="field-label">Password</span>
                        <div className="field-input">
                            <Lock />
                            <input
                                type={showPass ? 'text' : 'password'}
                                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                                placeholder="••••••••"
                                value={form.password}
                                onChange={e => update('password', e.target.value)}
                                required
                            />
                            <button
                                type="button"
                                className="reveal"
                                aria-label={showPass ? 'Hide password' : 'Show password'}
                                onClick={() => setShowPass(s => !s)}
                            >
                                {showPass ? <EyeOff /> : <Eye />}
                            </button>
                        </div>
                    </label>

                    {note && <div className="auth-note">{note}</div>}
                    {error && <div className="auth-error">{error}</div>}

                    <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                        <span>{submitLabel}</span>
                        {!submitting && <ArrowRight />}
                    </button>
                </form>

                {mode === 'admin' && (
                    <div className="auth-switch">
                        <span className="auth-switch-label">Team member?</span>
                        <div className="auth-switch-row">
                            <button type="button" className="btn btn-ghost" onClick={() => switchMode('signup')}>
                                <UserPlus /><span>Sign up</span>
                            </button>
                            <button type="button" className="btn btn-ghost" onClick={() => switchMode('signin')}>
                                <LogIn /><span>Sign in</span>
                            </button>
                        </div>
                    </div>
                )}

                {mode === 'signin' && (
                    <div className="auth-switch">
                        <span className="auth-switch-label">
                            New here?{' '}
                            <button type="button" className="auth-link" onClick={() => switchMode('signup')}>
                                Create an account
                            </button>
                        </span>
                        <button type="button" className="auth-back" onClick={() => switchMode('admin')}>
                            <ArrowLeft /><span>Admin login</span>
                        </button>
                    </div>
                )}

                {mode === 'signup' && (
                    <div className="auth-switch">
                        <span className="auth-switch-label">
                            Already have an account?{' '}
                            <button type="button" className="auth-link" onClick={() => switchMode('signin')}>
                                Sign in
                            </button>
                        </span>
                        <button type="button" className="auth-back" onClick={() => switchMode('admin')}>
                            <ArrowLeft /><span>Admin login</span>
                        </button>
                    </div>
                )}

                {mode === 'admin' && (
                    <p className="auth-foot">Protected workspace · authorized personnel only</p>
                )}
            </div>
        </section>
    );
}
