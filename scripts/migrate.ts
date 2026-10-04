import { migrate, pool } from "../lib/db";
await migrate();
await pool().query(
  "INSERT INTO ft_tenants(id) VALUES('system') ON CONFLICT DO NOTHING",
);
await pool().end();
console.log("Database schema v2 ready (subscriptions)");
