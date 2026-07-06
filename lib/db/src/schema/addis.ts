import { pgTable, serial, text, integer, timestamp, boolean, numeric } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";
import { usersTable } from "./users";

export const suppliersAddisTable = pgTable("suppliers_addis", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  addressEthiopia: text("address_ethiopia"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importShipmentsTable = pgTable("import_shipments", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliersAddisTable.id),
  reference: text("reference").notNull(),
  sentDate: text("sent_date").notNull(),
  estimatedArrivalDate: text("estimated_arrival_date"),
  actualArrivalDate: text("actual_arrival_date"),
  status: text("status").notNull().default("sent"),
  totalValueEtb: numeric("total_value_etb", { precision: 12, scale: 2 }).notNull().default("0"),
  totalValueAed: numeric("total_value_aed", { precision: 12, scale: 2 }).notNull().default("0"),
  exchangeRateUsed: numeric("exchange_rate_used", { precision: 10, scale: 4 }).notNull().default("1"),
  notes: text("notes"),
  discrepancyNotes: text("discrepancy_notes"),
  loggedByUserId: integer("logged_by_user_id").notNull().references(() => usersTable.id),
  receivedByUserId: integer("received_by_user_id").references(() => usersTable.id),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importShipmentItemsTable = pgTable("import_shipment_items", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id").notNull().references(() => importShipmentsTable.id),
  itemName: text("item_name").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  unitCostEtb: numeric("unit_cost_etb", { precision: 10, scale: 2 }).notNull().default("0"),
  unitCostAed: numeric("unit_cost_aed", { precision: 10, scale: 2 }).notNull().default("0"),
  totalCostEtb: numeric("total_cost_etb", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCostAed: numeric("total_cost_aed", { precision: 12, scale: 2 }).notNull().default("0"),
});

export const importPaymentsTable = pgTable("import_payments", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id").notNull().references(() => importShipmentsTable.id),
  amountAed: numeric("amount_aed", { precision: 12, scale: 2 }).notNull(),
  paymentDate: text("payment_date").notNull(),
  paymentMethod: text("payment_method").notNull(),
  notes: text("notes"),
  recordedByUserId: integer("recorded_by_user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exchangeRatesTable = pgTable("exchange_rates", {
  id: serial("id").primaryKey(),
  fromCurrency: text("from_currency").notNull(),
  toCurrency: text("to_currency").notNull(),
  rate: numeric("rate", { precision: 12, scale: 4 }).notNull(),
  setByUserId: integer("set_by_user_id").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cronJobLogsTable = pgTable("cron_job_logs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  message: text("message"),
  errorDetails: text("error_details"),
});
