import PacingDashboard from "@/components/PacingDashboard";
import { getEvents, getInstanceAvailability } from "@/lib/spektrix";
import { DATA } from "@/data/pacingData";

// Rebuild with fresh live data every 5 minutes.
export const revalidate = 300;

export default async function Home() {
  // Pre-fetch live data from availability API (fast, single call per show)
  // instead of orders API (slow, month-by-month). This gives the all-committed
  // count (Sold + Scanned) which matches the By-Performance page.
  const inProgress = DATA.filter(s => s.inProgress);
  const initialLiveData = {};

  if (inProgress.length) {
    try {
      const events = await getEvents();
      const todayPacific = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const [ty, tm, td] = todayPacific.split('-').map(Number);
      const todayUtcMs = Date.UTC(ty, tm - 1, td);

      for (const show of inProgress) {
        const event = events.find(e => e.name?.toLowerCase() === show.name.toLowerCase());
        if (!event) continue;
        const instances = await getInstanceAvailability(event.id);
        const total = instances.reduce((s, i) => s + i.sold, 0);
        const [oy, om, od] = show.open.split('-').map(Number);
        const openUtcMs = Date.UTC(oy, om - 1, od);
        const d = Math.round((todayUtcMs - openUtcMs) / 86400000);
        initialLiveData[show.name] = { d, c: total };
      }
    } catch {
      // Fall back to empty initialLiveData; client-side effects will retry
    }
  }

  return <PacingDashboard initialLiveData={initialLiveData} />;
}
