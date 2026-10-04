import Platform from "@/components/platform";
import { demoMode } from "@/lib/db";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Platform demo={demoMode()} />;
}
