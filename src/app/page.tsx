import PacingDashboard from "@/components/PacingDashboard";
import { getLivePacingData } from "@/lib/livePacing";
import { DATA } from "@/data/pacingData";

// Rebuild with fresh live data every 5 minutes.
// Users get the cached pre-fetched count instantly on load — no flash of stale data.
export const revalidate = 300;

export default async function Home() {
  // Fetch live counts server-side so the component has real data on first render
  const initialLiveData = await getLivePacingData(DATA).catch(() => ({}));
  return <PacingDashboard initialLiveData={initialLiveData} />;
}
