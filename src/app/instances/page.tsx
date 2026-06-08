import InstanceView from "@/components/InstanceView";
import { getEvents, getInstanceAvailability } from "@/lib/spektrix";
import { getLivePacingData } from "@/lib/livePacing";
import { DATA } from "@/data/pacingData";

export const metadata = {
  title: "SLO Rep · By Performance",
  description: "Tickets sold per instance vs capacity",
};

// Always render fresh — availability data changes constantly and the ISR cache
// was causing stale per-instance counts to persist across deployments.
export const dynamic = 'force-dynamic';

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
