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
  errorMessage,
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

let seedRoom: Room | undefined;

// Built on first use: the lineup scores the whole founder pool against every investor, which is
// too much work to do at import time on every page.
export function getSeedRoom(): Room {
  if (seedRoom) return seedRoom;
  const lineup = buildRoom("biotech/therapeutics", loadFounders(), loadInvestors(), loadDebriefs());
  seedRoom = {
    id: "room-seed-1",
    title: "Biotech pre-seed room",
    sector: "biotech/therapeutics",
    date: "2026-12-03",
    venue: "Venue TBC, London",
    founderIds: lineup.founderIds,
    investorIds: lineup.investorIds,
    hostInvestorId: lineup.investorIds[0],
    seeded: true,
  };
  return seedRoom;
}
