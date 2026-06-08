import { ToastProvider } from './contexts/ToastContext.jsx';
import { useTheme } from './hooks/useTheme.js';
import { useAuth } from './hooks/useAuth.js';
import { LoginScreen } from './components/LoginScreen.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { SuperAdminApp } from './components/SuperAdminApp.jsx';

export default function App() {
    const { theme, toggle } = useTheme();
    const { authed, ready, user, login, signUp, signIn, logout } = useAuth();

    function renderAuthed() {
        // Super admin gets its own console; everyone else (tenants) gets the
        // unchanged tenant Dashboard.
        if (user?.kind === 'super_admin') {
            return <SuperAdminApp theme={theme} onToggleTheme={toggle} onLogout={logout} user={user} />;
        }
        return <Dashboard theme={theme} onToggleTheme={toggle} onLogout={logout} user={user} />;
    }

    return (
        <ToastProvider>
            {!ready
                ? <div className="auth-shell" aria-hidden="true" />
                : authed
                    ? renderAuthed()
                    : <LoginScreen
                        theme={theme}
                        onToggleTheme={toggle}
                        onLogin={login}
                        onSignIn={signIn}
                        onSignUp={signUp}
                    />}
        </ToastProvider>
    );
}
