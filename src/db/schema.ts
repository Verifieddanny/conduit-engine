import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const StatusEnum = pgEnum("status", [
  "active",
  "inactive"
]);
export const callbackEnum = pgEnum("callback_status", [
  "pending", "delivered", "failed", "dead"
]);

export const userTable = pgTable("user", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password").notNull(),
  apiKey: varchar("api_key").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const endpointTable = pgTable("endpoint", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  endpointPath: text("endpoint_path").notNull(),
  secret: varchar("secret").notNull(),
  status: StatusEnum("status").notNull().default("active"),
  subscribedEvent: text("subscribed_event").array().notNull(),
  externalSource: text("external_source").notNull(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const callbackTable = pgTable("callback", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  status: callbackEnum("status").notNull().default("pending"),
  responseCode: varchar("response_code"),
  responseBody: text("response_body"),
  attempts: integer("attempts").default(0).notNull(),
  nextRetry: timestamp("next_retry", { withTimezone: true, mode: "string" }),
  payload: text("payload"),
  eventType: varchar("event_type").notNull(),
  endpointId: bigint("endpoint_id", { mode: "number" }).notNull().references(() => endpointTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});



export const userTableRelations = relations(userTable, ({ many, one }) => ({
  endpoints: many(endpointTable)
}));

export const endpointTableRelations = relations(
  endpointTable,
  ({ many, one }) => ({
    user: one(userTable, {
      fields: [endpointTable.userId],
      references: [userTable.id],
    }),
    callbacks: many(callbackTable),
  }),
);

export const callbackTableRelations = relations(callbackTable, ({ one }) => ({
  endpoint: one(endpointTable, {
    fields: [callbackTable.endpointId],
    references: [endpointTable.id],
  }),
}));

