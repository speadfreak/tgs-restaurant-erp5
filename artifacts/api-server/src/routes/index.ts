import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import branchesRouter from "./branches";
import usersRouter from "./users";
import menuRouter from "./menu";
import ordersRouter from "./orders";
import deliveriesRouter from "./deliveries";
import customersRouter from "./customers";
import financeRouter from "./finance";
import inventoryRouter from "./inventory";
import payrollRouter from "./payroll";
import lotteryRouter from "./lottery";
import dashboardRouter from "./dashboard";
import suppliersRouter from "./suppliers";
import restockRouter from "./restock";
import activitiesRouter from "./activities";
import whatsappQueueRouter from "./whatsapp-queue";
import addisRouter from "./addis";
import cronStatusRouter from "./cron-status";
import auditRouter from "./audit";
import auditXlsxRouter from "./audit-xlsx";
import settingsRouter from "./settings";
import backupRouter from "./backup";

const router: IRouter = Router();

// ── Public / role-specific routes first (no router-level admin gate) ─────────
// IMPORTANT: Express runs every mounted sub-router in order for every request.
// Sub-routers that use `router.use(authenticate, requireRole(...))` at the top
// (without a path prefix) will reject non-matching roles BEFORE the request
// reaches later routers. So role-specific portals (addis, etc.) MUST be
// registered BEFORE any admin-gated sub-router that doesn't include that role.
router.use(healthRouter);
router.use(authRouter);
router.use("/", whatsappQueueRouter);  // Twilio webhook (public)
router.use(menuRouter);                // GET endpoints are public; writes need ADMIN
router.use(ordersRouter);              // per-route auth (kitchen_staff, delivery_staff, etc.)

// ── Role-specific portals — must precede admin-gated routers ─────────────────
// addis_staff is NOT in ADMIN_ROLES/DELIVERY_ROLES/ORDER_INTAKE_ROLES, so these
// must be mounted before customersRouter / deliveriesRouter / usersRouter.
router.use(branchesRouter);            // GET list: any authenticated staff; writes: ADMIN
router.use("/addis", addisRouter);     // ADDIS_ROLES (addis_staff + super_admin)

// ── Routers with blanket admin/delivery/order_intake role guards ──────────────
router.use(customersRouter);           // per-router: ADMIN + ORDER_INTAKE + DELIVERY
router.use(deliveriesRouter);          // per-router: ADMIN + DELIVERY

// ── Admin-only sub-routers ────────────────────────────────────────────────────
router.use(usersRouter);
router.use(financeRouter);
router.use(inventoryRouter);
router.use(payrollRouter);
router.use(lotteryRouter);
router.use(dashboardRouter);
router.use(suppliersRouter);
router.use(restockRouter);
router.use(activitiesRouter);
router.use(cronStatusRouter);
router.use(auditRouter);
router.use(auditXlsxRouter);
router.use(settingsRouter);
router.use(backupRouter);

export default router;
