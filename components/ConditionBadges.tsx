import { Badge } from "@/components/ui/Badge";
import { CONDITION_TONE, parseConditionGrade } from "@/lib/conditionGrade";

/** Renders the Raw/Graded type as one badge and the condition or grade as a second, separately-colored badge. */
export function ConditionBadges({ conditionGrade }: { conditionGrade: string }) {
  const parsed = parseConditionGrade(conditionGrade);

  if (parsed.type === "RAW") {
    return (
      <>
        <Badge tone="gold">Raw</Badge>
        <Badge tone={CONDITION_TONE[parsed.condition]}>{parsed.condition}</Badge>
      </>
    );
  }

  return (
    <>
      <Badge tone="gold">Graded</Badge>
      <Badge tone="gold">
        {parsed.grader} {parsed.gradeNumber}
      </Badge>
    </>
  );
}
