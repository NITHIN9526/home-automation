BEGIN;
CREATE TABLE dashboards (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 title varchar(80) NOT NULL DEFAULT 'My dashboard',
 version integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dashboard_widgets (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES dashboards(user_id) ON DELETE CASCADE,
 device_id uuid NOT NULL,
 pin varchar(3) NOT NULL,
 kind text NOT NULL CHECK(kind IN ('switch','slider','gauge','value','chart')),
 label varchar(60) NOT NULL,
 config jsonb NOT NULL,
 layouts jsonb NOT NULL,
 sort_order integer NOT NULL,
 FOREIGN KEY(device_id,pin) REFERENCES device_pins(device_id,pin) ON DELETE CASCADE
);
CREATE INDEX widgets_owner_idx ON dashboard_widgets(user_id,sort_order);
CREATE TABLE automations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device_id uuid NOT NULL,
 pin varchar(3) NOT NULL,
 name varchar(80) NOT NULL,
 value jsonb NOT NULL,
 timezone varchar(80) NOT NULL,
 schedule jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 next_run_at timestamptz,
 token_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(device_id,pin) REFERENCES device_pins(device_id,pin) ON DELETE CASCADE
);
CREATE INDEX automations_due_idx ON automations(next_run_at) WHERE enabled=true;
CREATE INDEX automations_owner_idx ON automations(user_id,created_at);
CREATE TABLE automation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
 scheduled_for timestamptz NOT NULL,
 command_id uuid REFERENCES device_commands(id) ON DELETE SET NULL,
 status text NOT NULL CHECK(status IN ('queued','acknowledged','expired','cancelled','skipped','unconfirmed')),
 detail text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(automation_id,scheduled_for)
);
CREATE INDEX automation_runs_time_idx ON automation_runs(automation_id,created_at DESC);
COMMIT;
