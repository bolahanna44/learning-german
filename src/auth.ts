import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import db from './db';

export type UserRecord = {
  id: number;
  email: string;
  password_hash: string;
  a11_progress: number;
  a12_progress: number;
  a21_progress: number;
  a22_progress: number;
  b11_progress: number;
  b12_progress: number;
};

declare global {
  namespace Express {
    interface User extends UserRecord {}
  }
}

passport.use(
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const normalisedEmail = email.trim().toLowerCase();
        const user = db
          .prepare('SELECT * FROM users WHERE email = ?')
          .get(normalisedEmail) as UserRecord | undefined;
        if (!user) {
          return done(null, false, { message: 'Ungültige Anmeldedaten.' });
        }
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
          return done(null, false, { message: 'Ungültige Anmeldedaten.' });
        }
        return done(null, user);
      } catch (err) {
        return done(err as Error);
      }
    }
  )
);

passport.serializeUser((user: UserRecord, done) => {
  done(null, user.id);
});

passport.deserializeUser((id: number, done) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
    done(null, user ?? null);
  } catch (err) {
    done(err as Error);
  }
});

export default passport;
