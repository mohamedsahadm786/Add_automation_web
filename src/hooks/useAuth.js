import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { ADMIN_PASS, ADMIN_USER, SESSION_KEY } from '../lib/constants.js';

// Two ways in:
//  • Super admin (platform owner): hardcoded ADMIN_USER/ADMIN_PASS, gated by a
//    sessionStorage flag. No Supabase Auth involved. Lands on the super-admin
//    console (see SuperAdminApp), NOT the tenant dashboard.
//  • Members: real Supabase Auth (email + password). supabase-js issues and
//    refreshes a JWT and persists the session across reloads. Each member is a
//    tenant scoped to tenant_id = auth.users.id.
// `authed` is true if either path is active.
// Derive the "who's logged in" identity. A real Supabase member session ALWAYS
// wins over a lingering super-admin flag, so a signed-in member is never
// mistaken for the super admin.
function deriveUser(session) {
    if (session?.user) {
        const u = session.user;
        const name = u.user_metadata?.name?.trim() || u.email?.split('@')[0] || 'Member';
        return { kind: 'member', id: u.id, name, email: u.email || null, role: 'Member' };
    }
    if (sessionStorage.getItem(SESSION_KEY) === 'ok') {
        return { kind: 'super_admin', id: null, name: 'Super Admin', email: null, role: 'Platform owner' };
    }
    return null;
}

export function useAuth() {
    const [authed, setAuthed] = useState(false);
    const [user, setUser] = useState(null);
    const [ready, setReady] = useState(false);

    const adminFlag = () => sessionStorage.getItem(SESSION_KEY) === 'ok';

    const sync = (session) => {
        setAuthed(adminFlag() || Boolean(session));
        setUser(deriveUser(session));
    };

    useEffect(() => {
        let mounted = true;
        supabase.auth.getSession().then(({ data }) => {
            if (!mounted) return;
            sync(data.session);
            setReady(true);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            sync(session);
        });
        return () => { mounted = false; sub.subscription.unsubscribe(); };
    }, []);

    // Super-admin login (unchanged behavior). Clear any member session first so
    // the two identities never coexist.
    const login = useCallback(async (username, password) => {
        await new Promise(r => setTimeout(r, 360)); // let the spinner show
        if (username === ADMIN_USER && password === ADMIN_PASS) {
            await supabase.auth.signOut();
            sessionStorage.setItem(SESSION_KEY, 'ok');
            setAuthed(true);
            setUser(deriveUser(null));
            return { ok: true };
        }
        return { ok: false, error: 'Invalid credentials. Please check your username and password.' };
    }, []);

    // Member sign up (name stored in user metadata). Drop any admin flag first.
    const signUp = useCallback(async ({ name, email, password }) => {
        sessionStorage.removeItem(SESSION_KEY);
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name } },
        });
        if (error) return { ok: false, error: error.message };
        // If email confirmation is disabled in Supabase, a session is returned
        // and the user is logged straight in. If it's enabled, session is null
        // and they must confirm via email before signing in.
        if (data.session) {
            setAuthed(true);
            return { ok: true, signedIn: true };
        }
        return { ok: true, signedIn: false };
    }, []);

    // Member sign in. Drop any admin flag first.
    const signIn = useCallback(async ({ email, password }) => {
        sessionStorage.removeItem(SESSION_KEY);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { ok: false, error: error.message };
        setAuthed(Boolean(data.session));
        return { ok: true };
    }, []);

    const logout = useCallback(async () => {
        sessionStorage.removeItem(SESSION_KEY);
        await supabase.auth.signOut();
        setAuthed(false);
        setUser(null);
    }, []);

    return { authed, ready, user, login, signUp, signIn, logout };
}
