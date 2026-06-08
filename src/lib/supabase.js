import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './constants.js';

// persistSession/autoRefreshToken on: members sign in via Supabase Auth and
// their JWT is kept fresh across reloads. The hardcoded super-admin path uses
// a separate sessionStorage flag (see useAuth) and doesn't rely on this.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
});
