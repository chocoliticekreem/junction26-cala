import { buildRoom } from "@/lib/roomBuilder";
import { loadDebriefs, loadFounders, loadInvestors } from "@/lib/data";
import type { Room } from "@/lib/types";

export {
  INVESTOR_OPEN_CAP,
  EXPIRY_DAYS,
  emptyStore,
  expressInterest,
  acceptInterest,
  declineInterest,
  recheckVerification,
  expireStale,
  openInterestCount,
  sendMessage,
  requestSeat,
  decideSeat,
  upsertVerification,
  type InterestStore,
  type Result,
} from "@/lib/interest";
export { verifyInvestor, verifyFounder } from "@/lib/verification";
export { rankFounders, type FounderMatch } from "@/lib/scoring";
export { suggestRooms, buildRoom, type RoomSuggestion } from "@/lib/roomBuilder";
export { loadInvestors, loadFounders, loadDebriefs, usingFixtures } from "@/lib/data";

const seedLineup = buildRoom("biotech/therapeutics", loadFounders(), loadInvestors(), loadDebriefs());

export const SEED_ROOM: Room = {
  id: "room-seed-1",
  title: "Biotech pre-seed room",
  sector: "biotech/therapeutics",
  date: "2026-12-03",
  venue: "Venue TBC, London",
  founderIds: seedLineup.founderIds,
  investorIds: seedLineup.investorIds,
  hostInvestorId: seedLineup.investorIds[0],
  seeded: true,
};
