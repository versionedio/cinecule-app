import { PIPELINE_STAGES, ProjectStatus } from "@/config/entities";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Perforated film-strip stage tracker — a row of small bordered squares, one
 * per pipeline stage, echoing film-frame sprocket holes. Filled + bordered
 * gold = complete, thick gold border = current stage, hairline border =
 * upcoming, brick-red = the stage a failure happened in.
 */
export default function PipelineTimeline({
  status,
  compact = false
}: {
  status: ProjectStatus;
  compact?: boolean;
}) {
  const failed = status === "failed";
  const archived = status === "archived";
  const currentIdx = failed || archived ? -1 : PIPELINE_STAGES.findIndex((s) => s.status === status);
  const failedIdx = failed ? PIPELINE_STAGES.length - 1 : -1;

  return (
    <TooltipProvider delayDuration={150}>
      <div
        aria-label={`Pipeline status: ${failed ? "failed" : status}`}
        className={cn("flex w-full gap-1", compact ? "" : "min-w-[280px]")}
      >
        {PIPELINE_STAGES.map((stage, i) => {
          const done = currentIdx > i || status === "ready" || archived;
          const active = currentIdx === i && status !== "ready";
          const isFailedFrame = failed && i === failedIdx;

          return (
            <Tooltip key={stage.status}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex-1 rounded-[1px] border transition-colors",
                    compact ? "h-[10px]" : "h-[20px]",
                    isFailedFrame && "border-destructive bg-destructive/20",
                    !isFailedFrame && failed && "border-border/60",
                    !failed && done && "border-primary bg-primary/20",
                    !failed && active && "border-2 border-primary",
                    !failed && !done && !active && "border-border/60",
                    archived && "opacity-50"
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>{stage.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
