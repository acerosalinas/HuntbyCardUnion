"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Star as StarIcon } from "lucide-react";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StarRating } from "@/components/ui/StarRating";
import { createClient } from "@/lib/supabase/client";

function NewReviewForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const claimId = searchParams.get("claimId");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!claimId) {
    return (
      <p className="text-sm text-foreground-muted">
        No item selected. Go back to My Dibs and choose a received item to review.
      </p>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("submit_review", {
        p_claim_id: claimId,
        p_rating: rating,
        p_comment: comment.trim() || null,
      });
      if (rpcError) throw rpcError;
      router.push("/account/dibs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Rating
        </label>
        <StarRating value={rating} onChange={setRating} size={28} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Comment (optional)
        </label>
        <Textarea
          rows={5}
          placeholder="How was your experience with this seller?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-sold">{error}</p>}
      <Button type="submit" variant="gold" className="w-full" disabled={submitting}>
        {submitting ? "Submitting..." : "Submit Review"}
      </Button>
    </form>
  );
}

export default function NewReviewPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <StarIcon size={26} />
      </div>
      <h1 className="text-xl font-semibold">Leave a Review</h1>
      <Suspense>
        <NewReviewForm />
      </Suspense>
    </div>
  );
}
