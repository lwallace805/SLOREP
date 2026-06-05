import PacingDashboard from "@/components/PacingDashboard";
import { getLivePacingData } from "@/lib/livePacing";
import { DATA } from "@/data/pacingData";

// Rebuild with fresh live data every 5 minutes.
export const revalidate = 300;

export default async function Home() {
  const initialLiveData = await getLivePacingData(DATA).catch(() => ({}));
  return <PacingDashboard initialLiveData={initialLiveData} />;
}
