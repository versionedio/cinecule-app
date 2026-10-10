import { STATUS_COLORS } from "@/config/entities";
import { Badge } from "@/components/ui/badge";

export default function StatusChip({ status }: { status?: string }) {
  if (!status) return null;
  const color = STATUS_COLORS[status] ?? "#8d867a";
  return <Badge color={color}>{status}</Badge>;
}
