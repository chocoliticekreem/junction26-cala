// Adapter seam. When the real engine lands, repoint each line to "@/lib/..." and delete mockEngine/mockData.
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
} from "@/components/dev-e/mockEngine"; // -> "@/lib/interest"
export { verifyInvestor, verifyFounder } from "@/components/dev-e/mockEngine"; // -> "@/lib/verification"
export { rankFounders, type FounderMatch } from "@/components/dev-e/mockEngine"; // -> "@/lib/scoring"
export { suggestRooms, buildRoom, type RoomSuggestion } from "@/components/dev-e/mockEngine"; // -> "@/lib/roomBuilder"
export { loadInvestors, loadFounders, loadDebriefs, usingFixtures, SEED_ROOM } from "@/components/dev-e/mockData"; // -> "@/lib/data" (SEED_ROOM stays local)
