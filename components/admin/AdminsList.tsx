"use client";

import { Fragment, useState, useTransition } from "react";
import { KeyRound, Power } from "lucide-react";
import { AdminAccount, resetAdminPassword, setAdminActive } from "@/app/admin/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { extractErrorMessage } from "@/lib/utils";

export function AdminsList({ admins }: { admins: AdminAccount[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  if (admins.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No admin accounts yet.</p>;
  }

  const handleToggleActive = (admin: AdminAccount) => {
    const verb = admin.active ? "deactivate" : "reactivate";
    if (!window.confirm(`Are you sure you want to ${verb} ${admin.email}?`)) return;
    setError(null);
    setBusyId(admin.id);
    startTransition(async () => {
      try {
        await setAdminActive(admin.id, !admin.active);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to update account");
      } finally {
        setBusyId(null);
      }
    });
  };

  const handleResetPassword = (adminId: string) => {
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    setError(null);
    setBusyId(adminId);
    startTransition(async () => {
      try {
        await resetAdminPassword(adminId, newPassword);
        setResetNotice("Password updated.");
        setNewPassword("");
        setResettingId(null);
        setTimeout(() => setResetNotice(null), 5000);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to reset password");
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-sold">{error}</p>}
      {resetNotice && <p className="text-sm text-available">{resetNotice}</p>}
      <div className="overflow-x-auto rounded-2xl border border-card-border">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Handle</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => {
              const busy = pending && busyId === admin.id;
              const isResetting = resettingId === admin.id;
              return (
                <Fragment key={admin.id}>
                  <tr className="border-t border-card-border">
                    <td className="px-4 py-3 font-medium">{admin.email}</td>
                    <td className="px-4 py-3 text-foreground-muted">{admin.handle ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={admin.role === "SUPER_ADMIN" ? "gold" : "neutral"}>
                        {admin.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={admin.active ? "available" : "sold"}>
                        {admin.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {new Date(admin.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setResettingId(isResetting ? null : admin.id);
                            setNewPassword("");
                            setError(null);
                          }}
                        >
                          <KeyRound size={14} />
                          Reset Password
                        </Button>
                        <Button
                          variant={admin.active ? "danger" : "primary"}
                          disabled={busy}
                          onClick={() => handleToggleActive(admin)}
                        >
                          <Power size={14} />
                          {admin.active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {isResetting && (
                    <tr className="border-t border-card-border bg-card">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <PasswordInput
                            placeholder="New password (min 6 characters)"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="max-w-xs"
                          />
                          <Button
                            variant="gold"
                            disabled={busy}
                            onClick={() => handleResetPassword(admin.id)}
                          >
                            Save New Password
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
