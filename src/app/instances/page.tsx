import InstanceView from "@/components/InstanceView";
import { getEvents, getInstanceAvailability } from "@/lib/spektrix";
import { currentShowFromEvents, pacificToday } from "@/lib/showStatus";

export const metadata = {
  title: "SLO Rep · By Performance",
  description: "Tickets sold per instance vs capacity",
};

// ISR with 5-minute TTL — this pre-fetch is only for the instant initial paint.
// The InstanceView client component always re-fetches from /api/instances on
// mount, so stale ISR data is replaced with live data within milliseconds.
export const revalidate = 300;

async function _getDefaultShowData() {
  const events = await getEvents();

  // Open on the production being marketed right now — of the shows whose run
  // has not ended, the one opening soonest — rather than a hardcoded title.
  const defaultShow = currentShowFromEvents(
    (events as any[]).map((e) => ({
      name: e.name,
      firstInstance: e.firstInstanceDateTime,
      lastInstance: e.lastInstanceDateTime,
    })),
    pacificToday()
  );
  if (!defaultShow) return null;

  const event = (events as any[]).find((e) => e.name === defaultShow);
  if (!event) return null;

  // Availability API — fast (1 call), gives per-instance sold/cap.
  const instances = await getInstanceAvailability(event.id);

  return { name: event.name, eventId: event.id, instances };
}

async function getDefaultShowData() {
  try {
    // 30s hard ceiling so Spektrix slowness doesn't blow the 60s build limit.
    return await Promise.race([
      _getDefaultShowData(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 30000)
      ),
    ]);
  } catch {
    return null;
  }
}

export default async function InstancesPage() {
  const initialData = await getDefaultShowData();
  return <InstanceView initialData={initialData} />;
}
