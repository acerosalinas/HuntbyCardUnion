import { MessageSquare } from "lucide-react";
import { StarRating } from "@/components/ui/StarRating";
import { formatRelativeTime } from "@/lib/utils";
import { Review } from "@/types/marketplace";

export function SellerReviews({ reviews }: { reviews: Review[] }) {
  const average = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : null;

  return (
    <div className="mt-6 rounded-2xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Reviews</h2>
        {average !== null && (
          <div className="flex items-center gap-2">
            <StarRating value={average} readOnly size={16} />
            <span className="text-sm text-foreground-muted">
              {average.toFixed(1)} ({reviews.length} review{reviews.length === 1 ? "" : "s"})
            </span>
          </div>
        )}
      </div>

      {reviews.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
          <MessageSquare size={16} />
          No reviews yet.
        </p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="border-t border-card-border pt-4 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StarRating value={review.rating} readOnly size={14} />
                  <span className="text-sm font-medium text-foreground">{review.buyerHandle}</span>
                </div>
                <span className="text-xs text-foreground-muted">{formatRelativeTime(review.createdAt)}</span>
              </div>
              {review.comment && <p className="mt-1.5 text-sm text-foreground-muted">{review.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
