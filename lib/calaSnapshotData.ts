import data from "@/data/cala-snapshot.json";
import type { CalaSnapshot } from "./calaSnapshot";

// Bundled with the route handlers, so it needs no filesystem access at runtime.
export const SNAPSHOT = data as unknown as CalaSnapshot;
