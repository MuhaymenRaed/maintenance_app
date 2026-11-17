import type { AccessGrant } from "../../site/lib/permissions.ts";
import type { DeskDeputyRef, RepairService } from "../../site/lib/data/repair-desk.ts";
import type { StepSupport } from "../../site/lib/data/orders.ts";
import type { StockModel } from "../../site/lib/data/device-catalogue.ts";
import type { DeskAvailability } from "../../shared/desk-types";
import { ROLE_DEFAULTS } from "../../site/lib/permissions.ts";
import { store } from "../db/store";

/**
 * The reference data the desk draws with, as kept in `refs` — read from the
 * server whenever the line is up, and used from here when it is not. Every
 * reader goes through these accessors so a missing reference is always an
 * empty list rather than an `undefined` somewhere deep in a component.
 */

export type Viewer = { id: string; name: string; email: string; role: string; grant: AccessGrant };
export type BenchPerson = {
  userId: string;
  name: string;
  role: string;
  managerId: string | null;
  technicianId: string | null;
};
export type Branch = { id: string; name_ar: string; name_en: string };
export type Brand = { code: string; name_ar: string; name_en: string };
export type Issue = { code: string; name_ar: string; name_en: string; service: RepairService };

export const refs = {
  viewer: () => store.ref<Viewer>("viewer") ?? null,
  people: (service: RepairService) => store.ref<BenchPerson[]>(`people:${service}`) ?? [],
  deputies: () => store.ref<DeskDeputyRef[]>("deputies") ?? [],
  directory: () => store.ref<Record<string, { name: string; role: string }>>("directory") ?? {},
  branches: () => store.ref<Branch[]>("branches") ?? [],
  brands: () => store.ref<Brand[]>("brands") ?? [],
  models: () => store.ref<Record<string, StockModel[]>>("models") ?? {},
  issues: () => store.ref<Issue[]>("issues") ?? [],
  // `workDone` defaults off: offering «انتهاء عمل الصيانة» before the database
  // has the value is a press every save refuses. The pull asks.
  steps: (): StepSupport => ({
    preparing: true,
    waitingParts: true,
    inspecting: true,
    workDone: false,
    ...store.ref<Partial<StepSupport>>("steps"),
  }),
  available: (): DeskAvailability =>
    store.ref<DeskAvailability>("available") ?? { service: true, finance: true, warranty: true, customFaults: true },
};

export const emptyGrant = (): AccessGrant => ({ ...ROLE_DEFAULTS });
