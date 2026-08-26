import PacingDashboard from "@/components/PacingDashboard";
import { getLivePacingData } from "@/lib/livePacing";
import { getRunWindows, isOnSale, pacificToday } from "@/lib/showStatus";
import { DATA } from "@/data/pacingData";

// Rebuild with fresh live data every 5 minutes.
export const revalidate = 300;

async function loadServerData() {
  // Run windows come from Spektrix (first/last instance per event). They decide
  // which show the dashboard opens on and which shows still have live numbers,
  // so the dashboard follows the season without anyone editing the data file.
  const runWindows = await getRunWindows();
  const today = pacificToday();
  const onSale = DATA.filter(
    (s: any) => isOnSale(s, runWindows, today) && s.series.length > 0
  );
  const initialLiveData = await getLivePacingData(onSale);
  return { runWindows, initialLiveData };
}

export default async function Home() {
  // 30s hard ceiling so slow Spektrix calls don't blow the 60s build limit.
  // Falling back to empty props still renders: the client picks the current
  // show from opening dates alone and re-fetches live data on mount.
  const { runWindows, initialLiveData } = await Promise.race([
    loadServerData(),
    new Promise<{ runWindows: any; initialLiveData: any }>((resolve) =>
      setTimeout(() => resolve({ runWindows: {}, initialLiveData: {} }), 30000)
    ),
  ]).catch(() => ({ runWindows: {}, initialLiveData: {} }));

  return (
    <PacingDashboard initialLiveData={initialLiveData} runWindows={runWindows} />
  );
}
