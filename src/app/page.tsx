import PacingDashboard from "@/components/PacingDashboard";
import { getLivePacingData } from "@/lib/livePacing";
import { DATA } from "@/data/pacingData";

// Rebuild with fresh live data every 5 minutes.
export const revalidate = 300;

export default async function Home() {
  // Add a 30s timeout so slow Spektrix API calls don't blow the 60s build limit.
  const initialLiveData = await Promise.race([
    getLivePacingData(DATA),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 30000)
    ),
  ]).catch(() => ({}));
  return <PacingDashboard initialLiveData={initialLiveData} />;
}
