BEGIN;
CREATE TABLE device_pins (
 device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 pin varchar(3) NOT NULL CHECK(pin ~ '^V([0-9]|[12][0-9]|3[01])$'),
 label varchar(60) NOT NULL CHECK(length(trim(label))>0),
 data_type text NOT NULL CHECK(data_type IN ('number','boolean')),
 direction text NOT NULL CHECK(direction IN ('input','output')),
 unit varchar(12) NOT NULL DEFAULT '',
 min_value double precision NOT NULL DEFAULT 0,
 max_value double precision NOT NULL DEFAULT 100 CHECK(max_value>min_value),
 value jsonb,
 reported_at timestamptz,
 PRIMARY KEY(device_id,pin)
);
CREATE TABLE device_commands (
 id uuid PRIMARY KEY,
 device_id uuid NOT NULL,
 pin varchar(3) NOT NULL,
 value jsonb NOT NULL,
 token_version integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged','expired','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 seconds',
 acknowledged_at timestamptz,
 FOREIGN KEY(device_id,pin) REFERENCES device_pins(device_id,pin) ON DELETE CASCADE
);
CREATE UNIQUE INDEX one_pending_command_per_pin ON device_commands(device_id,pin) WHERE status='pending';
CREATE INDEX commands_device_time ON device_commands(device_id,created_at DESC);
CREATE INDEX commands_expiry ON device_commands(expires_at) WHERE status='pending';
CREATE TABLE telemetry_samples (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 device_id uuid NOT NULL,
 pin varchar(3) NOT NULL,
 value double precision NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(device_id,pin) REFERENCES device_pins(device_id,pin) ON DELETE CASCADE
);
CREATE INDEX samples_device_pin_time ON telemetry_samples(device_id,pin,received_at DESC,id DESC);
CREATE INDEX samples_retention ON telemetry_samples(received_at);
-- Existing devices and tokens remain intact. Seed the three simulator channels.
INSERT INTO device_pins(device_id,pin,label,data_type,direction,unit,min_value,max_value)
 SELECT id,'V0','Temperature','number','input','°C',-40,125 FROM devices;
INSERT INTO device_pins(device_id,pin,label,data_type,direction)
 SELECT id,'V1','Power','boolean','output' FROM devices;
INSERT INTO device_pins(device_id,pin,label,data_type,direction,unit)
 SELECT id,'V2','Brightness','number','output','%' FROM devices;
COMMIT;
