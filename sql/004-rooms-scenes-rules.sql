BEGIN;
CREATE TABLE device_groups (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(80) NOT NULL, kind text NOT NULL CHECK(kind IN ('room','group')),
 device_ids uuid[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX groups_owner ON device_groups(user_id);
CREATE TABLE scenes (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(80) NOT NULL, actions jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scenes_owner ON scenes(user_id);
CREATE TABLE sensor_rules (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(80) NOT NULL, source_device uuid NOT NULL,
 source_pin varchar(3) NOT NULL, source_token_version integer NOT NULL,
 operator text NOT NULL CHECK(operator IN ('above','below')),
 threshold double precision NOT NULL, hysteresis double precision NOT NULL CHECK(hysteresis>=0),
 cooldown integer NOT NULL CHECK(cooldown BETWEEN 10 AND 86400),
 actions jsonb NOT NULL, enabled boolean NOT NULL DEFAULT true,
 armed boolean NOT NULL DEFAULT false, observed_at timestamptz, last_fired_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_device,source_pin) REFERENCES device_pins(device_id,pin) ON DELETE CASCADE
);
CREATE INDEX rules_owner ON sensor_rules(user_id);
CREATE INDEX rules_active ON sensor_rules(source_device,source_pin) WHERE enabled;
CREATE TABLE routine_runs (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_id uuid NOT NULL, source_kind text NOT NULL CHECK(source_kind IN ('scene','rule')),
 name varchar(80) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source_kind,id)
);
CREATE INDEX runs_owner_time ON routine_runs(user_id,created_at DESC);
CREATE TABLE routine_results (
 run_id uuid NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE,
 ordinal integer NOT NULL, device_id uuid NOT NULL, pin varchar(3) NOT NULL,
 value jsonb NOT NULL, command_id uuid REFERENCES device_commands(id) ON DELETE SET NULL,
 outcome text NOT NULL, detail text NOT NULL DEFAULT '', PRIMARY KEY(run_id,ordinal)
);
COMMIT;
