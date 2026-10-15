-- Known devices: browser + system + country per account, so a sign-in from somewhere new triggers an email alert.
CREATE TABLE IF NOT EXISTS known_devices (user_id TEXT NOT NULL, fp TEXT NOT NULL, label TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (user_id, fp));
