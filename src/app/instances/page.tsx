import InstanceView from "@/components/InstanceView";
import { getEvents, getInstanceAvailability } from "@/lib/spektrix";
import { getLivePacingData } from "@/lib/livePacing";
import { DATA } from "@/data/pacingData";

export const metadata = {
  title: "SLO Rep · By Performance",
  description: "Tickets sold per instance vs capacity",
};

// ISR with 5-minute TTL — this pre-fetch is only for the instant initial paint.
// The InstanceView client component always re-fetches from /api/instances on
// mount, so stale ISR data is replaced with live data within milliseconds.
export const revalidate = 300;

const DEFAULT_SHOW = "A Grand Night for Singing";

async function getDefaultShowData() {
  try {
    const events = await getEvents();
    const event = events.find(
      (e: any) => e.name?.toLowerCase() === DEFAULT_SHOW.toLowerCase()
    );
    if (!event) return null;

    // Availability API — fast (1 call), gives per-instance sold/cap
    const instances = await getInstanceAvailability((event as any).id);

    // Accurate total from orders (includes comps + subscriptions)
    const inProgressShows = (DATA as any[]).filter(
      (s) => s.name === DEFAULT_SHOW && s.inProgress
    );
    const liveMap = await getLivePacingData(inProgressShows).catch(() => ({}));
    const accurateTotal: number | null = (liveMap as any)[DEFAULT_SHOW]?.c ?? null;

    return {
      name: (event as any).name,
      eventId: (event as any).id,
      instances,
      accurateTotal,
    };
  } catch {
    return null;
  }
}

export default async function InstancesPage() {
  const initialData = await getDefaultShowData();
  return <InstanceView initialData={initialData} />;
}
