/// <reference types="vite/client" />
import type { DeskApi } from "../shared/contract";

declare global {
  interface Window {
    /** The one door out of the window — see `src/preload/preload.ts`. */
    desk: DeskApi;
  }
}
