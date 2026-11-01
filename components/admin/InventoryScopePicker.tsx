"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { Select } from "@/components/ui/Select";

export interface ScopeStore {
  id: string;
  label: string;
  count: number;
}

interface Props {
  /** "mine", "all" or another admin's id - whatever the page is currently showing. */
  value: string;
  myCount: number;
  stores: ScopeStore[];
  allCount: number;
}

/** Super admin only: choose whose listings the Inventory Manager shows. Your own come first and are the default. */
export function InventoryScopePicker({ value, myCount, stores, allCount }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const change = (next: string) => {
    startTransition(() => router.push(next === "mine" ? "/admin/inventory" : `/admin/inventory?store=${encodeURIComponent(next)}`));
  };

  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      <label htmlFor="inventory-scope" className="inline-flex items-center gap-1.5 text-sm text-foreground-muted">
        <Store size={14} aria-hidden="true" />
        Showing
      </label>
      <Select id="inventory-scope" value={value} disabled={pending} onChange={(e) => change(e.target.value)} className="w-auto min-w-52">
        <option value="mine">My listings ({myCount})</option>
        {stores.length > 0 && (
          <optgroup label="Other shops">
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.count})
              </option>
            ))}
          </optgroup>
        )}
        <option value="all">All listings ({allCount})</option>
      </Select>
    </div>
  );
}
